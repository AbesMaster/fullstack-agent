import { and, between, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { agentTasks, bookings, contacts, emailLog, enquiries, eventRegistrations, programmeEvents, services } from "../db/schema";
import { expireRegistrationHolds } from "../programme/events";
import { recordTask, isEmergencyStopped, listPendingApprovals } from "./controls";
import { ownerAttentionItems } from "./workflows";
import { sendTemplate } from "../email/send";
import { budgetAlerts, forecast, monthOf, monthlyActuals, scenarioAssumptions, REVENUE_TARGETS_MINOR } from "../finance/finance";
import { publish } from "../events/bus";
import { jarvis } from "../jarvis/connector";
import { formatInZone } from "../booking/time";
import { PENDING_HOLD_MINUTES } from "../booking/booking";
import { formatMoney, newId } from "../util";
import { signResourceToken } from "../security/tokens";
import { env } from "../config/env";

/**
 * Durable scheduled operations (section 20). Each job is idempotent, recorded as an
 * agent task, and respects the emergency stop. The worker (scripts/worker.ts) or an
 * external scheduler calls runDueJobs() regularly; jobs decide for themselves what is due.
 */

export type Report = { title: string; lines: string[]; kind: "daily_brief" | "evening_summary" | "weekly" | "monthly" };

async function alreadyRan(db: DB, kind: string, key: string) {
  const rows = await db.select({ id: agentTasks.id }).from(agentTasks).where(and(eq(agentTasks.kind, kind), eq(agentTasks.correlationId, key), eq(agentTasks.status, "succeeded")));
  return rows.length > 0;
}

/* ---------------- Morning ---------------- */

export async function morningBrief(db: DB, now = new Date()): Promise<Report> {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86400_000);
  const newEnquiries = await db.select().from(enquiries).where(inArray(enquiries.status, ["new", "qualified", "escalated"]));
  const today = await db.select({ b: bookings, s: services }).from(bookings).innerJoin(services, eq(bookings.serviceId, services.id)).where(and(eq(bookings.status, "confirmed"), gte(bookings.startsAt, dayStart), lt(bookings.startsAt, dayEnd)));
  const pending = await listPendingApprovals(db);
  const attention = await ownerAttentionItems(db);
  const unpaid = await db.select().from(bookings).where(eq(bookings.status, "pending_payment"));
  return {
    kind: "daily_brief",
    title: `Daily brief — ${now.toISOString().slice(0, 10)}`,
    lines: [
      `${today.length} session(s) today${today.length ? ": " + today.map(({ b, s }) => `${formatInZone(b.startsAt, "Europe/London")} ${s.name}`).join("; ") : ""}.`,
      `${newEnquiries.length} open enquiry(ies) (${newEnquiries.filter((e) => e.status === "escalated").length} escalated to you).`,
      `${pending.length} approval(s) waiting · ${attention.length} item(s) need your attention.`,
      `${unpaid.length} booking(s) awaiting payment.`,
    ],
  };
}

/* ---------------- Reminders & aftercare ---------------- */

export async function sendReminders(db: DB, now = new Date()) {
  const from = new Date(now.getTime() + 23 * 3600_000);
  const to = new Date(now.getTime() + 25 * 3600_000);
  const due = await db.select({ b: bookings, s: services, c: contacts }).from(bookings).innerJoin(services, eq(bookings.serviceId, services.id)).innerJoin(contacts, eq(bookings.contactId, contacts.id)).where(and(eq(bookings.status, "confirmed"), between(bookings.startsAt, from, to)));
  let sent = 0;
  for (const { b, s, c } of due) {
    const [prior] = await db.select().from(emailLog).where(and(eq(emailLog.template, "appointment_reminder"), eq(emailLog.correlationId, `reminder:${b.id}`)));
    if (prior) continue;
    await sendTemplate(db, "appointment_reminder", c.email, { name: c.name, service: s.name, when: formatInZone(b.startsAt, b.clientTimezone) }, `reminder:${b.id}`);
    sent++;
  }
  return { sent };
}

/** After a session ends: mark completed, send thank-you, then (next day) the optional feedback request. */
export async function aftercare(db: DB, now = new Date()) {
  const ended = await db.select({ b: bookings, s: services, c: contacts }).from(bookings).innerJoin(services, eq(bookings.serviceId, services.id)).innerJoin(contacts, eq(bookings.contactId, contacts.id)).where(and(eq(bookings.status, "confirmed"), lt(bookings.endsAt, now)));
  for (const { b, s, c } of ended) {
    await db.update(bookings).set({ status: "completed" }).where(eq(bookings.id, b.id));
    await publish(db, "SESSION_COMPLETED", { bookingId: b.id }, { correlationId: newId("cor"), idempotencyKey: b.id });
    if (s.id === "discovery-call") {
      await sendTemplate(db, "post_discovery_follow_up", c.email, { name: c.name }, `aftercare:${b.id}`);
    } else {
      await sendTemplate(db, "post_session_thank_you", c.email, { name: c.name }, `aftercare:${b.id}`);
    }
  }
  // Feedback requests 24h after completion, paid sessions only, once.
  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 3600_000);
  const fb = await db.select({ b: bookings, c: contacts }).from(bookings).innerJoin(contacts, eq(bookings.contactId, contacts.id)).where(and(eq(bookings.status, "completed"), between(bookings.endsAt, twoDaysAgo, dayAgo), sql`${bookings.amountMinor} > 0`));
  let feedback = 0;
  for (const { b, c } of fb) {
    const [prior] = await db.select().from(emailLog).where(eq(emailLog.correlationId, `feedback:${b.id}`));
    if (prior) continue;
    await sendTemplate(db, "feedback_request", c.email, { name: c.name, feedbackUrl: `${env().APP_URL}/feedback?b=${b.id}&t=${signResourceToken("feedback", b.id)}` }, `feedback:${b.id}`);
    feedback++;
  }
  return { completed: ended.length, feedback };
}

/** Releases unpaid holds so abandoned checkouts don't block the diary. */
export async function expireUnpaidHolds(db: DB, now = new Date()) {
  const cutoff = new Date(now.getTime() - PENDING_HOLD_MINUTES * 60_000);
  const stale = await db.update(bookings).set({ status: "cancelled", cancelledAt: now }).where(and(eq(bookings.status, "pending_payment"), lt(bookings.createdAt, cutoff))).returning({ id: bookings.id });
  for (const s of stale) await publish(db, "PAYMENT_FAILED", { paymentId: "expired-hold", bookingId: s.id }, { correlationId: newId("cor"), idempotencyKey: `expired:${s.id}` });
  return { expired: stale.length };
}

/** 24-hour reminders for confirmed event registrants, once each. */
export async function sendEventReminders(db: DB, now = new Date()) {
  const from = new Date(now.getTime() + 23 * 3600_000);
  const to = new Date(now.getTime() + 25 * 3600_000);
  const due = await db
    .select({ r: eventRegistrations, ev: programmeEvents, c: contacts })
    .from(eventRegistrations)
    .innerJoin(programmeEvents, eq(eventRegistrations.eventId, programmeEvents.id))
    .innerJoin(contacts, eq(eventRegistrations.contactId, contacts.id))
    .where(and(eq(eventRegistrations.status, "confirmed"), between(programmeEvents.startsAt, from, to), inArray(programmeEvents.status, ["open", "full", "closed"])));
  let sent = 0;
  for (const { r, ev, c } of due) {
    const [prior] = await db.select().from(emailLog).where(eq(emailLog.correlationId, `event-reminder:${r.id}`));
    if (prior) continue;
    await sendTemplate(db, "event_reminder", c.email, { name: c.name, event: ev.title, when: formatInZone(ev.startsAt, "Europe/London"), logistics: `Location: ${ev.location}.` }, `event-reminder:${r.id}`);
    sent++;
  }
  return { sent };
}

/* ---------------- Finance ---------------- */

export async function financialOps(db: DB, now = new Date()) {
  const alerts = await budgetAlerts(db, monthOf(now), now);
  for (const a of alerts) await publish(db, "BUDGET_ALERT", a, { correlationId: newId("cor"), idempotencyKey: `${monthOf(now)}:${a.rule}:${a.message}` });
  return { alerts: alerts.length };
}

/* ---------------- Reports ---------------- */

export async function periodReport(db: DB, kind: "weekly" | "monthly", now = new Date()): Promise<Report> {
  const month = monthOf(now);
  const a = await monthlyActuals(db, month, now);
  const assumptions = await scenarioAssumptions(db);
  const base = forecast("base", assumptions.base, month, 1).months[0]!;
  const next = REVENUE_TARGETS_MINOR.find((t) => t > a.recognisedRevenueMinor);
  return {
    kind,
    title: `${kind === "weekly" ? "Weekly" : "Monthly"} report — ${now.toISOString().slice(0, 10)}`,
    lines: [
      `ACTUAL (${month} to date): recognised ${formatMoney(a.recognisedRevenueMinor)}, cash ${formatMoney(a.cashCollectedMinor)}, refunds ${formatMoney(a.refundsMinor)}, expenses ${formatMoney(a.expensesMinor)}, operating profit ${formatMoney(a.operatingProfitMinor)}.`,
      `Pipeline: ${a.discoveryCalls} discovery call(s), ${a.bookings} booking(s), ${a.newClients} new / ${a.returningClients} returning client(s).`,
      `FORECAST (base, from assumptions): ${formatMoney(base.revenueMinor)} for ${month}.`,
      `TARGET: next milestone ${next ? formatMoney(next) : "all milestones met"} — a strategic aim, not a guarantee.`,
      "Recommendations are proposals only; pricing, spend and campaigns require your approval.",
    ],
  };
}

/* ---------------- Runner ---------------- */

export async function runDueJobs(db: DB, now = new Date()) {
  if (await isEmergencyStopped(db)) return { halted: true };
  const day = now.toISOString().slice(0, 10);
  const hourLondon = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(now));
  const results: Record<string, unknown> = {};

  results.holds = await recordTask(db, "scheduling", "expire_unpaid_holds", undefined, {}, () => expireUnpaidHolds(db, now));
  results.reminders = await recordTask(db, "scheduling", "send_reminders", undefined, {}, () => sendReminders(db, now));
  results.eventHolds = await recordTask(db, "events", "expire_registration_holds", undefined, {}, () => expireRegistrationHolds(db, now));
  results.eventReminders = await recordTask(db, "events", "send_event_reminders", undefined, {}, () => sendEventReminders(db, now));
  results.aftercare = await recordTask(db, "client-experience", "aftercare", undefined, {}, () => aftercare(db, now));

  const daily = async (kind: string, agent: string, hour: number, fn: () => Promise<unknown>) => {
    const key = `${kind}:${day}`;
    if (hourLondon >= hour && !(await alreadyRan(db, kind, key))) results[kind] = await recordTask(db, agent, kind, key, {}, fn);
  };
  await daily("report:daily_brief", "executive-ops", 7, () => morningBrief(db, now));
  await daily("finance:daily_ops", "finance", 8, () => financialOps(db, now));
  await daily("report:evening_summary", "executive-ops", 19, async () => ({ ...(await morningBrief(db, now)), kind: "evening_summary", title: `Evening summary — ${day}` }));

  if (now.getUTCDay() === 1) await daily("report:weekly", "commander", 8, () => periodReport(db, "weekly", now));
  if (now.getUTCDate() === 1) await daily("report:monthly", "finance", 8, () => periodReport(db, "monthly", now));

  // Optional parent-system reporting (off unless JARVIS is configured).
  if (results["report:daily_brief"]) {
    const a = await monthlyActuals(db, monthOf(now), now);
    await jarvis()
      .report({ type: "business_status", period: day, actualRevenueMinor: a.recognisedRevenueMinor, bookings: a.bookings, pendingApprovals: (await listPendingApprovals(db)).length, systemHealth: "ok" })
      .catch(() => undefined);
  }
  return results;
}

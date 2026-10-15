import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import { agentTasks, approvals, bookings, contacts, contentItems, enquiries, eventRegistrations, payments, programmeEvents, refundRequests, services } from "../db/schema";
import { EventBus, publish } from "../events/bus";
import { assertTool, recordTask, PermissionDenied } from "./controls";
import { crmProvider } from "../crm/provider";
import { calendarProvider } from "../calendar/provider";
import { paymentProvider } from "../payments/provider";
import { sendMarketingContent, sendTemplate } from "../email/send";
import { confirmPaidBooking } from "../payments/processing";
import { deleteBookingMeeting, ensureBookingMeeting, ensureEventMeeting, moveBookingMeeting } from "../video/meetings";
import { joinInstructions, VideoError } from "../video/provider";
import { confirmRegistrationAfterPayment } from "../programme/events";
import { escalationReason } from "../compliance/claims";
import { formatInZone } from "../booking/time";
import { signResourceToken } from "../security/tokens";
import { env } from "../config/env";
import { audit } from "../audit/audit";
import { formatMoney, newId } from "../util";

/**
 * Event-driven agent workflows (no free-form agent-to-agent chat):
 *
 *  LEAD_CREATED      → CRM agent (sync) → Lead Gen (qualify) → Client Experience (welcome email)
 *  LEAD_QUALIFIED    → Sales Ops (follow-up task)
 *  BOOKING_CONFIRMED → Scheduling (calendar) → Client Experience (confirmation/preparation) → CRM (lifecycle + deal)
 *  PAYMENT_CONFIRMED → Payments (confirm booking/registration) → Client Experience (receipt email)
 *  BOOKING_CANCELLED / RESCHEDULED → Scheduling + Client Experience
 *  INTAKE_SUBMITTED  → Client Experience (owner review if flagged)
 *  APPROVAL_DECIDED  → executes the approved action (only path to money/publish/marketing effects)
 */

async function escalateToOwner(db: DB, agentId: string, summary: string, correlationId: string, input: Record<string, unknown>) {
  await db.insert(agentTasks).values({ id: newId("tsk"), agentId, kind: "owner_attention", status: "blocked", correlationId, input: { summary, ...input } });
}

async function contactFor(db: DB, contactId: string) {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c) throw new Error(`Contact ${contactId} missing`);
  return c;
}

/** Calendar entries are Felicia's own; they carry the join link but never client details beyond a first name. */
function calendarDescription(b: typeof bookings.$inferSelect) {
  return [`Booking ${b.id}`, b.attendanceMode === "in_person" ? "In person" : b.videoJoinUrl ? `Zoom: ${b.videoJoinUrl}` : "Online"].join("\n");
}

async function bookingContext(db: DB, bookingId: string) {
  const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!b) throw new Error(`Booking ${bookingId} missing`);
  const [s] = await db.select().from(services).where(eq(services.id, b.serviceId));
  const c = await contactFor(db, b.contactId);
  return { b, s: s!, c, when: formatInZone(b.startsAt, b.clientTimezone) };
}

/** How the client joins: a Zoom link for online sessions, a note for in-person ones. */
export function bookingPlaceInfo(b: typeof bookings.$inferSelect) {
  if (b.attendanceMode === "in_person") return "This session is in person. Felicia will email you the venue address and directions before the day.";
  if (!b.videoJoinUrl) throw new VideoError("The video link for this session isn't ready yet; will retry", true);
  return joinInstructions(b);
}

/** Email variables for event registrants; creates the shared Zoom meeting first for online events. */
export async function eventEmailVars(db: DB, name: string, ev: typeof programmeEvents.$inferSelect) {
  const withMeeting = ev.isOnline ? ((await ensureEventMeeting(db, ev.id)) ?? ev) : ev;
  return registrationEmailVars(name, withMeeting);
}

export function registrationEmailVars(name: string, ev: typeof programmeEvents.$inferSelect) {
  return {
    joinInfo: ev.isOnline ? joinInstructions(ev) : "",
    name,
    event: ev.title,
    when: formatInZone(ev.startsAt, "Europe/London"),
    location: ev.location,
    healthNote: ev.includesBreathwork
      ? "This event includes breathwork. If you are pregnant, or have a heart, respiratory, seizure-related or serious mental health condition, please reply to this email before the day so Felicia can advise you or adapt the practice."
      : "",
  };
}

export function buildBus(): EventBus {
  const bus = new EventBus();

  /* ---------------- Leads ---------------- */

  bus.register({
    name: "crm.sync_lead",
    agentId: "crm",
    on: "LEAD_CREATED",
    run: (db, e) =>
      recordTask(db, "crm", "sync_contact", e.correlationId, e.payload, async () => {
        assertTool("crm", "crm.write");
        const c = await contactFor(db, e.payload.contactId);
        const r = await crmProvider().upsertContact({ email: c.email, name: c.name, phone: c.phone, lifecycleStage: c.lifecycleStage, source: c.source, marketingConsent: c.marketingConsent });
        await db.update(contacts).set({ crmExternalId: r.externalId }).where(eq(contacts.id, c.id));
        return { externalId: r.externalId, provider: crmProvider().name };
      }),
  });

  bus.register({
    name: "leadgen.qualify",
    agentId: "lead-gen",
    on: "LEAD_CREATED",
    run: (db, e) =>
      recordTask(db, "lead-gen", "qualify", e.correlationId, e.payload, async () => {
        const [enq] = await db.select().from(enquiries).where(eq(enquiries.id, e.payload.enquiryId));
        if (!enq) throw new Error("Enquiry missing");
        const reason = escalationReason(enq.message);
        if (reason) {
          await db.update(enquiries).set({ status: "escalated", escalationReason: reason }).where(eq(enquiries.id, enq.id));
          await escalateToOwner(db, "lead-gen", `Enquiry needs Felicia: ${reason}`, e.correlationId, { enquiryId: enq.id });
          await publish(db, "ENQUIRY_ESCALATED", { enquiryId: enq.id, reason }, { correlationId: e.correlationId, idempotencyKey: enq.id });
          return { escalated: reason };
        }
        // Declared-interest qualification only — no profiling, no scraped data.
        const m = enq.message.toLowerCase();
        const intent = enq.interestServiceId || /\b(book|booking|available|availability|price|cost|when can|session)\b/.test(m) ? "high" : /\b(interested|curious|tell me more|how does)\b/.test(m) ? "medium" : "low";
        await db.update(enquiries).set({ status: "qualified", bookingIntent: intent }).where(eq(enquiries.id, enq.id));
        await publish(db, "LEAD_QUALIFIED", { enquiryId: enq.id, contactId: enq.contactId, bookingIntent: intent }, { correlationId: e.correlationId, idempotencyKey: enq.id });
        return { bookingIntent: intent };
      }),
  });

  bus.register({
    name: "client_experience.enquiry_welcome",
    agentId: "client-experience",
    on: "LEAD_CREATED",
    run: (db, e) =>
      recordTask(db, "client-experience", "enquiry_welcome", e.correlationId, e.payload, async () => {
        assertTool("client-experience", "email.sendTransactional");
        const c = await contactFor(db, e.payload.contactId);
        return sendTemplate(db, "enquiry_welcome", c.email, { name: c.name, bookingUrl: `${env().APP_URL}/book?service=discovery-call` }, e.correlationId);
      }),
  });

  bus.register({
    name: "sales.follow_up_task",
    agentId: "sales-ops",
    on: "LEAD_QUALIFIED",
    run: async (db, e) => {
      // A follow-up is a TASK for review, never an automatic outbound message.
      await db.insert(agentTasks).values({
        id: newId("tsk"),
        agentId: "sales-ops",
        kind: "follow_up_draft",
        status: "queued",
        correlationId: e.correlationId,
        input: { enquiryId: e.payload.enquiryId, bookingIntent: e.payload.bookingIntent },
      });
    },
  });

  /* ---------------- Bookings ---------------- */

  // Runs first so the calendar entry and confirmation email can include the join link.
  bus.register({
    name: "video.booking_meeting",
    agentId: "scheduling",
    on: "BOOKING_CONFIRMED",
    run: (db, e) =>
      recordTask(db, "scheduling", "create_video_meeting", e.correlationId, e.payload, async () => {
        const b = await ensureBookingMeeting(db, e.payload.bookingId);
        return b ? { meeting: b.videoMeetingId } : "not_online";
      }),
  });

  bus.register({
    name: "scheduling.calendar_event",
    agentId: "scheduling",
    on: "BOOKING_CONFIRMED",
    run: (db, e) =>
      recordTask(db, "scheduling", "create_calendar_event", e.correlationId, e.payload, async () => {
        assertTool("scheduling", "calendar.write");
        const { b, s, c } = await bookingContext(db, e.payload.bookingId);
        if (b.calendarEventId) return { eventId: b.calendarEventId };
        // Minimum data in calendar: service + first name + booking id. No intake/health info.
        const r = await calendarProvider().createEvent({ summary: `${s.name} — ${c.name.split(" ")[0]}`, start: b.startsAt, end: b.endsAt, description: calendarDescription(b), idempotencyKey: b.id });
        await db.update(bookings).set({ calendarEventId: r.eventId }).where(eq(bookings.id, b.id));
        return r;
      }),
  });

  bus.register({
    name: "client_experience.booking_confirmation",
    agentId: "client-experience",
    on: "BOOKING_CONFIRMED",
    run: (db, e) =>
      recordTask(db, "client-experience", "booking_confirmation", e.correlationId, e.payload, async () => {
        const { b, s, c, when } = await bookingContext(db, e.payload.bookingId);
        const joinInfo = bookingPlaceInfo(b);
        if (s.id === "discovery-call") return sendTemplate(db, "discovery_booking_confirmation", c.email, { name: c.name, when, joinInfo }, e.correlationId);
        const intakeUrl = `${env().APP_URL}/intake?b=${b.id}&t=${signResourceToken("intake", b.id)}`;
        return sendTemplate(db, "session_preparation", c.email, { name: c.name, service: s.name, when, intakeUrl, joinInfo }, e.correlationId);
      }),
  });

  bus.register({
    name: "crm.booking_lifecycle",
    agentId: "crm",
    on: "BOOKING_CONFIRMED",
    run: (db, e) =>
      recordTask(db, "crm", "booking_lifecycle", e.correlationId, e.payload, async () => {
        const { b, s, c } = await bookingContext(db, e.payload.bookingId);
        const stage = s.id === "discovery-call" ? (c.lifecycleStage === "lead" ? "discovery" : c.lifecycleStage) : c.lifecycleStage === "client" || c.lifecycleStage === "returning_client" ? "returning_client" : "client";
        await db.update(contacts).set({ lifecycleStage: stage, updatedAt: new Date() }).where(eq(contacts.id, c.id));
        const crm = crmProvider();
        const r = await crm.upsertContact({ email: c.email, name: c.name, phone: c.phone, lifecycleStage: stage, source: c.source, marketingConsent: c.marketingConsent });
        if (b.amountMinor > 0) await crm.recordDeal(r.externalId, { name: `${s.name} (${b.id})`, amountMinor: b.amountMinor, stage: "closedwon", reference: b.id });
        return { stage };
      }),
  });

  bus.register({
    name: "scheduling.cancel",
    agentId: "client-experience",
    on: "BOOKING_CANCELLED",
    run: (db, e) =>
      recordTask(db, "client-experience", "cancellation_confirmation", e.correlationId, e.payload, async () => {
        const { s, c } = await bookingContext(db, e.payload.bookingId);
        const [p] = await db.select().from(payments).where(eq(payments.bookingId, e.payload.bookingId));
        const refundNote = p ? "If a refund applies under our cancellation policy, Felicia will review it and you'll hear from us within two working days." : "";
        return sendTemplate(db, "cancellation_confirmation", c.email, { name: c.name, service: s.name, refundNote }, e.correlationId);
      }),
  });

  bus.register({
    name: "video.cancel_meeting",
    agentId: "scheduling",
    on: "BOOKING_CANCELLED",
    run: (db, e) => recordTask(db, "scheduling", "delete_video_meeting", e.correlationId, e.payload, () => deleteBookingMeeting(db, e.payload.bookingId)),
  });

  bus.register({
    name: "scheduling.reschedule",
    agentId: "scheduling",
    on: "BOOKING_RESCHEDULED",
    run: (db, e) =>
      recordTask(db, "scheduling", "reschedule", e.correlationId, e.payload, async () => {
        await moveBookingMeeting(db, e.payload.bookingId);
        const { b, s, c, when } = await bookingContext(db, e.payload.bookingId);
        if (!b.calendarEventId) {
          const r = await calendarProvider().createEvent({ summary: `${s.name} — ${c.name.split(" ")[0]}`, start: b.startsAt, end: b.endsAt, description: calendarDescription(b), idempotencyKey: `${b.id}:${b.startsAt.toISOString()}` });
          await db.update(bookings).set({ calendarEventId: r.eventId }).where(eq(bookings.id, b.id));
        }
        return sendTemplate(db, "rescheduling_confirmation", c.email, { name: c.name, service: s.name, when, joinInfo: bookingPlaceInfo(b) }, e.correlationId);
      }),
  });

  /* ---------------- Payments ---------------- */

  bus.register({
    name: "payments.confirm",
    agentId: "payments",
    on: "PAYMENT_CONFIRMED",
    run: (db, e) =>
      recordTask(db, "payments", "confirm_after_payment", e.correlationId, e.payload, async () => {
        if (e.payload.bookingId) return { confirmed: await confirmPaidBooking(db, e.payload.bookingId, e.correlationId) };
        if (e.payload.registrationId) {
          return confirmRegistrationAfterPayment(db, e.payload.registrationId, e.correlationId);
        }
        return {};
      }),
  });

  bus.register({
    name: "client_experience.payment_receipt",
    agentId: "client-experience",
    on: "PAYMENT_CONFIRMED",
    run: (db, e) =>
      recordTask(db, "client-experience", "payment_confirmation", e.correlationId, e.payload, async () => {
        const [p] = await db.select().from(payments).where(eq(payments.id, e.payload.paymentId));
        if (!p) throw new Error("Payment missing");
        if (p.bookingId) {
          const { s, c } = await bookingContext(db, p.bookingId);
          return sendTemplate(db, "payment_confirmation", c.email, { name: c.name, service: s.name, amount: formatMoney(p.amountMinor, p.currency), reference: p.bookingId }, e.correlationId);
        }
        if (p.registrationId) {
          const [r] = await db.select().from(eventRegistrations).where(eq(eventRegistrations.id, p.registrationId));
          const [ev] = r ? await db.select().from(programmeEvents).where(eq(programmeEvents.id, r.eventId)) : [];
          const c = r ? await contactFor(db, r.contactId) : undefined;
          if (c && ev) return sendTemplate(db, "workshop_registration", c.email, await eventEmailVars(db, c.name, ev), e.correlationId);
        }
        return "skipped";
      }),
  });

  bus.register({
    name: "sales.payment_failed",
    agentId: "sales-ops",
    on: "PAYMENT_FAILED",
    run: async (db, e) => {
      // Abandoned/failed checkout: record for the sales report; no automatic chasing.
      await db.insert(agentTasks).values({ id: newId("tsk"), agentId: "sales-ops", kind: "abandoned_booking", status: "queued", correlationId: e.correlationId, input: e.payload });
    },
  });

  /* ---------------- Event registrations ---------------- */

  bus.register({
    name: "crm.sync_registrant",
    agentId: "crm",
    on: "EVENT_REGISTRATION_CREATED",
    run: (db, e) =>
      recordTask(db, "crm", "sync_registrant", e.correlationId, e.payload, async () => {
        const [r] = await db.select().from(eventRegistrations).where(eq(eventRegistrations.id, e.payload.registrationId));
        if (!r) throw new Error("Registration missing");
        const c = await contactFor(db, r.contactId);
        const res = await crmProvider().upsertContact({ email: c.email, name: c.name, phone: c.phone, lifecycleStage: c.lifecycleStage, source: c.source, marketingConsent: c.marketingConsent });
        await db.update(contacts).set({ crmExternalId: res.externalId }).where(eq(contacts.id, c.id));
        return { externalId: res.externalId };
      }),
  });

  bus.register({
    name: "events.free_registration_confirmation",
    agentId: "events",
    on: "EVENT_REGISTRATION_CREATED",
    run: (db, e) =>
      recordTask(db, "events", "registration_confirmation", e.correlationId, e.payload, async () => {
        // Paid places are confirmed by the payment receipt instead; this covers free events.
        const [r] = await db.select().from(eventRegistrations).where(eq(eventRegistrations.id, e.payload.registrationId));
        if (!r || r.status !== "confirmed" || r.amountMinor > 0) return "skipped";
        const [ev] = await db.select().from(programmeEvents).where(eq(programmeEvents.id, r.eventId));
        const c = await contactFor(db, r.contactId);
        return sendTemplate(db, "workshop_registration", c.email, await eventEmailVars(db, c.name, ev!), e.correlationId);
      }),
  });

  /* ---------------- Intake ---------------- */

  bus.register({
    name: "client_experience.intake_review",
    agentId: "client-experience",
    on: "INTAKE_SUBMITTED",
    run: async (db, e) => {
      if (e.payload.requiresReview) {
        await escalateToOwner(db, "client-experience", "Client intake has breathwork screening answers that need your review before the session.", e.correlationId, { bookingId: e.payload.bookingId });
      }
    },
  });

  /* ---------------- Approvals → execution ---------------- */

  bus.register({
    name: "approvals.execute",
    agentId: "executive-ops",
    on: "APPROVAL_DECIDED",
    run: async (db, e) => {
      if (e.payload.status === "approved") await executeApproved(db, e.payload.approvalId);
      else await onRejected(db, e.payload.approvalId);
    },
  });

  return bus;
}

/**
 * Executes an APPROVED action. Each branch re-checks the approval status so this can
 * never run on a pending/rejected request even if called directly.
 */
export async function executeApproved(db: DB, approvalId: string) {
  const [a] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
  if (!a) throw new Error("Approval not found");
  if (a.status !== "approved") throw new PermissionDenied("Approval is not approved");
  const payload = a.payload as Record<string, unknown>;
  const actor = `approved:${a.decidedBy}`;

  switch (a.action) {
    case "payments.refund": {
      const [r] = await db.select().from(refundRequests).where(eq(refundRequests.id, String(payload.refundRequestId)));
      if (!r || r.status === "processed") return;
      const [p] = await db.select().from(payments).where(eq(payments.id, r.paymentId));
      if (!p) throw new Error("Payment missing");
      const refund = await paymentProvider().refund(p.providerRef, r.amountMinor, `refund:${r.id}`);
      const refunded = p.refundedMinor + r.amountMinor;
      await db.update(payments).set({ refundedMinor: refunded, status: refunded >= p.amountMinor ? "refunded" : "partially_refunded" }).where(eq(payments.id, p.id));
      await db.update(refundRequests).set({ status: "processed" }).where(eq(refundRequests.id, r.id));
      await audit(db, { actor, action: "refund.processed", target: r.id, metadata: { refundId: refund.refundId, amountMinor: r.amountMinor } });
      return;
    }
    case "content.publish":
    case "email.send_marketing": {
      const id = String(payload.contentId);
      await db.update(contentItems).set({ status: "approved", updatedAt: new Date() }).where(and(eq(contentItems.id, id), eq(contentItems.status, "awaiting_approval")));
      if (a.action === "email.send_marketing") {
        const [item] = await db.select().from(contentItems).where(eq(contentItems.id, id));
        const audience = await db.select().from(contacts).where(eq(contacts.marketingConsent, true));
        const results: Record<string, number> = {};
        for (const c of audience) {
          const r = await sendMarketingContent(db, id, c.email, item!.title, item!.body, `newsletter:${id}`);
          results[r] = (results[r] ?? 0) + 1;
        }
        await db.update(contentItems).set({ status: "published", updatedAt: new Date() }).where(eq(contentItems.id, id));
        await audit(db, { actor, action: "newsletter.sent", target: id, metadata: results });
      } else {
        await audit(db, { actor, action: "content.approved_for_publishing", target: id, metadata: { note: "Publish via approved platform API or the manual posting pack." } });
      }
      return;
    }
    case "service.change_price": {
      await db
        .update(services)
        .set({ priceMinor: Number(payload.priceMinor), ownerApprovedPrice: true, updatedAt: new Date() })
        .where(eq(services.id, String(payload.serviceId)));
      await audit(db, { actor, action: "service.price_changed", target: String(payload.serviceId), metadata: payload });
      return;
    }
    default:
      // venue.book, agreement.sign, money.spend, ads.launch, outreach.send, infrastructure.production_change,
      // data.export_sensitive, access.change_permissions: approval recorded; a human performs or confirms the action.
      await db.insert(agentTasks).values({ id: newId("tsk"), agentId: a.agentId, kind: `approved_manual:${a.action}`, status: "queued", input: payload as never });
      await audit(db, { actor, action: "approval.manual_execution_required", target: a.id, metadata: { action: a.action } });
  }
}

async function onRejected(db: DB, approvalId: string) {
  const [a] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
  if (!a) return;
  const payload = a.payload as Record<string, unknown>;
  if (a.action === "content.publish" || a.action === "email.send_marketing") {
    await db.update(contentItems).set({ status: "rejected", updatedAt: new Date() }).where(eq(contentItems.id, String(payload.contentId)));
  }
  if (a.action === "payments.refund") {
    await db.update(refundRequests).set({ status: "rejected" }).where(eq(refundRequests.id, String(payload.refundRequestId)));
  }
}

/** Convenience used by the API: decide + emit event (execution happens in the bus, auditable + retryable). */
export async function decideAndDispatch(db: DB, approvalId: string, decision: "approved" | "rejected", user: { id: string; role: string }, note?: string) {
  const { decideApproval } = await import("./controls");
  await decideApproval(db, approvalId, decision, user, note);
  await publish(db, "APPROVAL_DECIDED", { approvalId, status: decision }, { correlationId: newId("cor"), idempotencyKey: approvalId });
}

/** Items that need Felicia, for the Command Center. */
export async function ownerAttentionItems(db: DB) {
  return db.select().from(agentTasks).where(and(eq(agentTasks.kind, "owner_attention"), inArray(agentTasks.status, ["blocked"])));
}

let busSingleton: EventBus | undefined;
export const bus = () => (busSingleton ??= buildBus());

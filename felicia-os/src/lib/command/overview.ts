import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { agentTasks, approvals, bookings, enquiries, eventRegistrations, payments, programmeEvents } from "../db/schema";
import { AGENTS, type AgentDefinition } from "../agents/registry";
import { isEmergencyStopped } from "../agents/controls";

/**
 * Data for JARVIS, the Command Center's live mission-control screen.
 * Every number comes from the business records or the agents' own task log; nothing is
 * estimated or invented. Client names, emails and messages are never included: the
 * activity feed shows only which agent did what kind of task, and whether it worked.
 */

export type Department = AgentDefinition["department"];

export const STREAMS: { department: Department; label: string; role: string; color: string }[] = [
  { department: "Executive Command", label: "Executive", role: "approvals & risk", color: "#e9e3d6" },
  { department: "Customer Acquisition", label: "Acquisition", role: "content, leads & sales", color: "#6f8fe8" },
  { department: "Business Operations", label: "Operations", role: "bookings, CRM & payments", color: "#e8945a" },
  { department: "Client Experiences", label: "Experiences", role: "clients & events", color: "#e46fb3" },
  { department: "Financial Intelligence", label: "Finance", role: "money & growth", color: "#3fcf9f" },
  { department: "International Expansion", label: "Expansion", role: "new markets", color: "#9b7cf0" },
];

const HOUR = 3600_000;

export async function commandOverview(db: DB, opts: { now?: Date; includeMoney: boolean }) {
  const now = opts.now ?? new Date();
  const dayAgo = new Date(now.getTime() - 24 * HOUR);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const ukMidnight = startOfUkDay(now);

  const tasks = await db.select().from(agentTasks).where(gte(agentTasks.createdAt, dayAgo)).orderBy(desc(agentTasks.createdAt));
  const agentDept = new Map(AGENTS.map((a) => [a.id, a.department] as const));

  const [pendingApprovals] = await db.select({ n: sql<number>`count(*)::int` }).from(approvals).where(eq(approvals.status, "pending"));
  const [enquiriesToday] = await db.select({ n: sql<number>`count(*)::int` }).from(enquiries).where(gte(enquiries.createdAt, ukMidnight));
  const [enquiries30] = await db.select({ n: sql<number>`count(*)::int` }).from(enquiries).where(gte(enquiries.createdAt, new Date(now.getTime() - 30 * 24 * HOUR)));
  const [upcomingSessions] = await db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(and(eq(bookings.status, "confirmed"), gte(bookings.startsAt, now)));
  const [bookingsMonth] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(inArray(bookings.status, ["confirmed", "completed", "no_show"]), gte(bookings.createdAt, monthStart)));
  const [eventPlaces] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(eventRegistrations)
    .innerJoin(programmeEvents, eq(eventRegistrations.eventId, programmeEvents.id))
    .where(and(eq(eventRegistrations.status, "confirmed"), gte(programmeEvents.startsAt, now)));
  const paid = await db
    .select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::int` })
    .from(payments)
    .where(and(inArray(payments.status, ["succeeded", "partially_refunded"]), gte(payments.paidAt, monthStart), lt(payments.paidAt, new Date(now.getTime() + 1))));
  const paidMonth = paid[0]!;
  const stopped = await isEmergencyStopped(db);

  const streams = STREAMS.map((s) => {
    const deptTasks = tasks.filter((t) => agentDept.get(t.agentId) === s.department);
    const hourly = Array.from({ length: 24 }, (_, i) => {
      const from = now.getTime() - (24 - i) * HOUR;
      return deptTasks.filter((t) => t.createdAt.getTime() >= from && t.createdAt.getTime() < from + HOUR).length;
    });
    const agents = AGENTS.filter((a) => a.department === s.department);
    const metric = streamMetric(s.department, {
      approvals: pendingApprovals!.n,
      enquiries30: enquiries30!.n,
      upcomingSessions: upcomingSessions!.n,
      eventPlaces: eventPlaces!.n,
      cashMinor: paidMonth.total,
      tasks24: deptTasks.length,
      includeMoney: opts.includeMoney,
    });
    return {
      ...s,
      agents: agents.map((a) => a.name),
      tasks24: deptTasks.length,
      succeeded24: deptTasks.filter((t) => t.status === "succeeded").length,
      needsAttention: deptTasks.filter((t) => t.status === "failed" || t.status === "blocked").length,
      hourly,
      metric,
    };
  });

  const lastTask = tasks[0];
  const running = tasks.some((t) => t.status === "running") || (lastTask && now.getTime() - lastTask.createdAt.getTime() < 15 * 60_000);
  const name = new Map(AGENTS.map((a) => [a.id, a.name] as const));

  return {
    generatedAt: now.toISOString(),
    state: stopped ? ("paused" as const) : running ? ("working" as const) : ("standing by" as const),
    top: {
      enquiriesToday: enquiriesToday!.n,
      bookingsMonth: bookingsMonth!.n,
      paidMonth: paidMonth.n,
      revenueMonthMinor: opts.includeMoney ? paidMonth.total : null,
      approvalsWaiting: pendingApprovals!.n,
      agents: AGENTS.length,
      tasks24: tasks.length,
    },
    streams,
    feed: tasks.slice(0, 12).map((t) => ({
      at: t.createdAt.toISOString(),
      agent: name.get(t.agentId) ?? t.agentId,
      department: agentDept.get(t.agentId) ?? null,
      kind: t.kind.replace(/[_.]/g, " "),
      status: t.status,
    })),
  };
}

export type CommandOverview = Awaited<ReturnType<typeof commandOverview>>;

function streamMetric(
  d: Department,
  m: { approvals: number; enquiries30: number; upcomingSessions: number; eventPlaces: number; cashMinor: number; tasks24: number; includeMoney: boolean },
): { value: string; label: string } {
  switch (d) {
    case "Executive Command":
      return { value: String(m.approvals), label: "waiting for your approval" };
    case "Customer Acquisition":
      return { value: String(m.enquiries30), label: "enquiries · last 30 days" };
    case "Business Operations":
      return { value: String(m.upcomingSessions), label: "sessions booked ahead" };
    case "Client Experiences":
      return { value: String(m.eventPlaces), label: "event places confirmed" };
    case "Financial Intelligence":
      return m.includeMoney
        ? { value: `£${(m.cashMinor / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`, label: "received this month" }
        : { value: "—", label: "finance access needed" };
    case "International Expansion":
      return { value: String(m.tasks24), label: "tasks run · 24 hours" };
  }
}

/** Midnight in London for the given instant. */
function startOfUkDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const sinceMidnight = (get("hour") * 3600 + get("minute") * 60 + get("second")) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - sinceMidnight);
}

import Link from "next/link";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db, requirePageUser } from "@/lib/server";
import { Card, Stat } from "@/components/admin/Stat";
import { EmergencyStop } from "@/components/admin/EmergencyStop";
import { monthOf, monthlyActuals, budgetAlerts, forecast, scenarioAssumptions, REVENUE_TARGETS_MINOR } from "@/lib/finance/finance";
import { listPendingApprovals, isEmergencyStopped } from "@/lib/agents/controls";
import { ownerAttentionItems } from "@/lib/agents/workflows";
import { agentTasks, bookings, domainEvents, enquiries, services } from "@/lib/db/schema";
import { integrationStatuses } from "@/lib/config/env";
import { formatMoney } from "@/lib/util";
import { formatInZone } from "@/lib/booking/time";

export default async function Overview() {
  const user = await requirePageUser("dashboard.view");
  const d = await db();
  const month = monthOf(new Date());
  const [a, pending, attention, alerts, assumptions, stopped] = await Promise.all([
    monthlyActuals(d, month),
    listPendingApprovals(d),
    ownerAttentionItems(d),
    budgetAlerts(d, month),
    scenarioAssumptions(d),
    isEmergencyStopped(d),
  ]);
  const base = forecast("base", assumptions.base, month, 1).months[0]!;
  const nextTarget = REVENUE_TARGETS_MINOR.find((t) => t > a.recognisedRevenueMinor) ?? REVENUE_TARGETS_MINOR.at(-1)!;
  const newEnquiries = await d.select().from(enquiries).where(eq(enquiries.status, "new"));
  const upcoming = await d.select({ b: bookings, s: services }).from(bookings).innerJoin(services, eq(bookings.serviceId, services.id)).where(and(eq(bookings.status, "confirmed"), gte(bookings.startsAt, new Date()))).orderBy(asc(bookings.startsAt)).limit(6);
  const [{ dead } = { dead: 0 }] = await d.select({ dead: sql<number>`count(*)::int` }).from(domainEvents).where(eq(domainEvents.status, "dead"));
  const [{ backlog } = { backlog: 0 }] = await d.select({ backlog: sql<number>`count(*)::int` }).from(domainEvents).where(eq(domainEvents.status, "pending"));
  const recentFailures = await d.select().from(agentTasks).where(eq(agentTasks.status, "failed")).orderBy(desc(agentTasks.createdAt)).limit(5);
  const integrations = integrationStatuses();
  const canFinance = user.role === "owner" || user.role === "admin";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-navy-800/60">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="text-4xl">Good day, {user.name.split(" ")[0]}</h1>
        </div>
        {(user.role === "owner" || user.role === "admin") && <EmergencyStop engaged={stopped} />}
      </div>

      {canFinance && (
        <section aria-label="Business performance" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={`Recognised revenue · ${month}`} value={formatMoney(a.recognisedRevenueMinor)} note="Delivered, paid sessions only" />
          <Stat label="Cash collected" value={formatMoney(a.cashCollectedMinor)} note={`Refunds ${formatMoney(a.refundsMinor)} · fees ${formatMoney(a.paymentFeesMinor)}`} />
          <Stat label="Base forecast (this month)" value={formatMoney(base.revenueMinor)} note="From editable assumptions — not a result" tone="forecast" />
          <Stat label="Next milestone" value={formatMoney(nextTarget)} note="Strategic target, not guaranteed" tone="target" />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`Pending approvals (${pending.length})`} action={<Link href="/admin/approvals" className="text-sm underline">Review</Link>}>
          {pending.length === 0 ? <p className="text-sm text-navy-800/60">Nothing waiting for you.</p> : (
            <ul className="space-y-2 text-sm">{pending.slice(0, 5).map((p) => <li key={p.id} className="rounded-lg bg-ivory p-2"><span className="font-medium">{p.action}</span> — {p.summary}</li>)}</ul>
          )}
        </Card>
        <Card title={`Needs your attention (${attention.length})`}>
          {attention.length === 0 ? <p className="text-sm text-navy-800/60">No escalations.</p> : (
            <ul className="space-y-2 text-sm">{attention.slice(0, 6).map((t) => <li key={t.id} className="rounded-lg bg-gold/10 p-2">{String((t.input as { summary?: string })?.summary ?? t.kind)}</li>)}</ul>
          )}
        </Card>
        <Card title="Alerts">
          {alerts.length === 0 && dead === 0 ? <p className="text-sm text-navy-800/60">No budget or system alerts.</p> : (
            <ul className="space-y-2 text-sm">
              {alerts.map((x) => <li key={x.rule + x.message} className="rounded-lg bg-red-50 p-2 text-red-900">{x.message}</li>)}
              {dead > 0 && <li className="rounded-lg bg-red-50 p-2 text-red-900">{dead} workflow event(s) failed repeatedly and need attention (see Agents).</li>}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`New enquiries (${newEnquiries.length})`} action={<Link href="/admin/clients" className="text-sm underline">Open</Link>}>
          <p className="text-sm text-navy-800/70">{a.discoveryCalls} discovery call(s) and {a.bookings} booking(s) this month. Conversion (discovery → paid): {a.discoveryToPaidConversionPct ?? "—"}{a.discoveryToPaidConversionPct != null ? "%" : ""}</p>
        </Card>
        <Card title="Upcoming sessions">
          {upcoming.length === 0 ? <p className="text-sm text-navy-800/60">No upcoming confirmed sessions.</p> : (
            <ul className="space-y-1 text-sm">{upcoming.map(({ b, s }) => <li key={b.id}>{formatInZone(b.startsAt, "Europe/London")} — {s.name}</li>)}</ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="System health">
          <ul className="space-y-1 text-sm">
            <li>Automation: {stopped ? "⛔ halted (emergency stop)" : "running"}</li>
            <li>Workflow backlog: {backlog} pending · {dead} dead-lettered</li>
            <li>Recent agent failures: {recentFailures.length}</li>
          </ul>
        </Card>
        <Card title="Integrations">
          <ul className="space-y-1 text-sm">
            {integrations.map((i) => (
              <li key={i.name} className="flex justify-between gap-2"><span>{i.name}</span><span className={i.configured ? "text-navy-900" : "text-earth"}>{i.configured ? "credentials configured (not verified)" : i.name === "database" ? "embedded dev database (not for production)" : "not connected — using mock"}</span></li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

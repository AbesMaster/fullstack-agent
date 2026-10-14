import Link from "next/link";
import { db, requirePageUser } from "@/lib/server";
import { Card, Stat } from "@/components/admin/Stat";
import { REVENUE_TARGETS_MINOR, eventProfitability, forecast, monthOf, monthlyActuals, scenarioAssumptions, type ScenarioName } from "@/lib/finance/finance";
import { formatMoney } from "@/lib/util";
import { AssumptionsEditor } from "@/components/admin/AssumptionsEditor";
import { ExpenseForm } from "@/components/admin/ExpenseForm";

const lastMonths = (n: number) => {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) out.push(monthOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))));
  return out;
};

export default async function Page() {
  const user = await requirePageUser("finance.view");
  const d = await db();
  const months = lastMonths(6);
  const actuals = await Promise.all(months.map((m) => monthlyActuals(d, m)));
  const current = actuals.at(-1)!;
  const assumptions = await scenarioAssumptions(d);
  const start = months.at(-1)!;
  const scenarios = (["conservative", "base", "growth"] as ScenarioName[]).map((s) => forecast(s, assumptions[s], start, 24));
  const events = await eventProfitability(d);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl">Financial intelligence</h1>
        <div className="flex gap-3 text-sm">
          <Link className="underline" href="/api/admin/finance?format=csv">Export actuals (CSV)</Link>
          <span className="text-navy-800/50">·</span>
          <span className="text-navy-800/60">Print with your browser for a report</span>
        </div>
      </div>
      <p className="rounded-xl bg-white p-4 text-sm">
        <strong>Actual</strong> figures come only from recorded payments and expenses. <strong>Forecasts</strong> are projections from the editable assumptions below. <strong>Targets</strong> are your milestones. They are never combined. Operating profit here is before tax and is not the same as owner income.
      </p>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Recognised revenue · ${current.month}`} value={formatMoney(current.recognisedRevenueMinor)} />
        <Stat label="Deferred (paid, not yet delivered)" value={formatMoney(current.deferredRevenueMinor)} />
        <Stat label="Expenses" value={formatMoney(current.expensesMinor)} note={`Marketing ${formatMoney(current.marketingSpendMinor)}`} />
        <Stat label="Operating profit" value={formatMoney(current.operatingProfitMinor)} note={`CAC ${current.customerAcquisitionCostMinor != null ? formatMoney(current.customerAcquisitionCostMinor) : "—"}`} />
      </section>

      <Card title="Actuals — last six months">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="text-xs uppercase text-navy-800/60"><tr><th className="p-2 text-left">Month</th><th className="p-2">Cash in</th><th className="p-2">Refunds</th><th className="p-2">Recognised</th><th className="p-2">Expenses</th><th className="p-2">Op. profit</th><th className="p-2">Bookings</th><th className="p-2">New / returning</th><th className="p-2">ATV</th></tr></thead>
            <tbody>
              {actuals.map((a) => (
                <tr key={a.month} className="border-t border-navy-900/5">
                  <td className="p-2 text-left">{a.month}</td><td className="p-2">{formatMoney(a.cashCollectedMinor)}</td><td className="p-2">{formatMoney(a.refundsMinor)}</td><td className="p-2">{formatMoney(a.recognisedRevenueMinor)}</td><td className="p-2">{formatMoney(a.expensesMinor)}</td><td className="p-2">{formatMoney(a.operatingProfitMinor)}</td><td className="p-2">{a.bookings}</td><td className="p-2">{a.newClients} / {a.returningClients}</td><td className="p-2">{a.averageTransactionMinor != null ? formatMoney(a.averageTransactionMinor) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Forecast scenarios (projections, not results)">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="text-xs uppercase text-navy-800/60"><tr><th className="p-2 text-left">Scenario</th><th className="p-2">Month 3 revenue</th><th className="p-2">Month 12 revenue</th><th className="p-2">Month 12 profit</th>{REVENUE_TARGETS_MINOR.map((t) => <th key={t} className="p-2">Reaches {formatMoney(t)}</th>)}</tr></thead>
            <tbody>
              {scenarios.map((f) => (
                <tr key={f.scenario} className="border-t border-navy-900/5">
                  <td className="p-2 text-left capitalize">{f.scenario}</td><td className="p-2">{formatMoney(f.months[2]!.revenueMinor)}</td><td className="p-2">{formatMoney(f.months[11]!.revenueMinor)}</td><td className="p-2">{formatMoney(f.months[11]!.profitMinor)}</td>
                  {REVENUE_TARGETS_MINOR.map((t) => <td key={t} className="p-2">{f.targetReachedMonth[t] ?? "not within 24 months"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(user.role === "owner" || user.role === "admin") && <AssumptionsEditor initial={assumptions} />}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Event profitability (actuals)">
          {events.length === 0 ? <p className="text-sm text-navy-800/60">No events recorded yet.</p> : (
            <ul className="space-y-1 text-sm">{events.map((e) => <li key={e.eventId}>{e.title}: revenue {formatMoney(e.paidRevenueMinor)} · costs {formatMoney(e.costMinor)} (budget {formatMoney(e.budgetMinor)}) · contribution {formatMoney(e.contributionMinor)}</li>)}</ul>
          )}
        </Card>
        <Card title="Record an expense"><ExpenseForm /></Card>
      </div>
    </div>
  );
}

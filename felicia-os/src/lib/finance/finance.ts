import { and, eq, gte, lt, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { bookings, contacts, eventRegistrations, expenses, payments, programmeEvents } from "../db/schema";
import { formatMoney } from "../util";
import { getSetting } from "../settings";

/**
 * Financial Intelligence. Three categories are NEVER mixed:
 *   ACTUAL   — computed from recorded payments/expenses only
 *   FORECAST — computed from editable assumptions (labelled as projections)
 *   TARGET   — the owner's milestones (aspirations, not results)
 */

export const REVENUE_TARGETS_MINOR = [300_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000];

export type MonthKey = `${number}-${string}`;
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}
export const monthOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export type MonthlyActuals = {
  month: string;
  kind: "actual";
  cashCollectedMinor: number; // gross receipts in month
  refundsMinor: number; // refunded amounts on payments received in month
  paymentFeesMinor: number;
  netCashMinor: number;
  recognisedRevenueMinor: number; // paid sessions DELIVERED in month
  deferredRevenueMinor: number; // paid, not yet delivered (as of `now`)
  bookings: number;
  discoveryCalls: number;
  newClients: number;
  returningClients: number;
  discoveryToPaidConversionPct: number | null;
  averageTransactionMinor: number | null;
  expensesMinor: number;
  marketingSpendMinor: number;
  customerAcquisitionCostMinor: number | null;
  operatingProfitMinor: number; // recognised revenue − fees − expenses (NOT owner income; excludes tax)
  serviceRevenue: Record<string, number>;
};

export async function monthlyActuals(db: DB, month: string, now = new Date()): Promise<MonthlyActuals> {
  const { from, to } = monthRange(month);
  const allPayments = await db.select().from(payments).where(eq(payments.status, "succeeded"));
  const partial = await db.select().from(payments).where(inArray(payments.status, ["partially_refunded", "refunded"]));
  const paid = [...allPayments, ...partial];
  const inMonth = paid.filter((p) => p.paidAt && p.paidAt >= from && p.paidAt < to);

  const allBookings = await db.select().from(bookings);
  const bookingById = new Map(allBookings.map((b) => [b.id, b]));
  const paidBookingIds = new Set(paid.filter((p) => p.bookingId).map((p) => p.bookingId!));
  const netPaidFor = (bookingId: string) =>
    paid.filter((p) => p.bookingId === bookingId).reduce((s, p) => s + p.amountMinor - p.refundedMinor, 0);

  let recognised = 0;
  let deferred = 0;
  const serviceRevenue: Record<string, number> = {};
  for (const id of paidBookingIds) {
    const b = bookingById.get(id);
    if (!b || b.status === "cancelled") continue;
    const amount = netPaidFor(id);
    if (b.endsAt <= now) {
      if (b.startsAt >= from && b.startsAt < to) {
        recognised += amount;
        serviceRevenue[b.serviceId] = (serviceRevenue[b.serviceId] ?? 0) + amount;
      }
    } else deferred += amount;
  }

  const monthBookings = allBookings.filter((b) => b.createdAt >= from && b.createdAt < to && b.status !== "cancelled");
  const discoveryCalls = monthBookings.filter((b) => b.serviceId === "discovery-call").length;

  // New vs returning: by each contact's FIRST paid booking.
  const firstPaid = new Map<string, Date>();
  for (const p of paid) {
    const b = p.bookingId ? bookingById.get(p.bookingId) : undefined;
    if (!b || !p.paidAt) continue;
    const prev = firstPaid.get(b.contactId);
    if (!prev || p.paidAt < prev) firstPaid.set(b.contactId, p.paidAt);
  }
  const payersInMonth = new Set(inMonth.map((p) => (p.bookingId ? bookingById.get(p.bookingId)?.contactId : undefined)).filter(Boolean) as string[]);
  let newClients = 0;
  let returningClients = 0;
  for (const c of payersInMonth) {
    const first = firstPaid.get(c)!;
    if (first >= from && first < to) newClients++;
    else returningClients++;
  }

  // Discovery → paid conversion for discovery calls booked this month.
  const discoveryContacts = new Set(monthBookings.filter((b) => b.serviceId === "discovery-call").map((b) => b.contactId));
  const converted = [...discoveryContacts].filter((c) => firstPaid.has(c)).length;

  const monthExpenses = await db
    .select()
    .from(expenses)
    .where(and(gte(expenses.incurredOn, from.toISOString().slice(0, 10)), lt(expenses.incurredOn, to.toISOString().slice(0, 10))));
  const expensesMinor = monthExpenses.reduce((s, e) => s + e.amountMinor, 0);
  const marketingSpendMinor = monthExpenses.filter((e) => e.category === "marketing").reduce((s, e) => s + e.amountMinor, 0);

  const cashCollectedMinor = inMonth.reduce((s, p) => s + p.amountMinor, 0);
  const refundsMinor = inMonth.reduce((s, p) => s + p.refundedMinor, 0);
  const paymentFeesMinor = inMonth.reduce((s, p) => s + p.feeMinor, 0);

  return {
    month,
    kind: "actual",
    cashCollectedMinor,
    refundsMinor,
    paymentFeesMinor,
    netCashMinor: cashCollectedMinor - refundsMinor - paymentFeesMinor,
    recognisedRevenueMinor: recognised,
    deferredRevenueMinor: deferred,
    bookings: monthBookings.length,
    discoveryCalls,
    newClients,
    returningClients,
    discoveryToPaidConversionPct: discoveryContacts.size ? Math.round((converted / discoveryContacts.size) * 1000) / 10 : null,
    averageTransactionMinor: inMonth.length ? Math.round(cashCollectedMinor / inMonth.length) : null,
    expensesMinor,
    marketingSpendMinor,
    customerAcquisitionCostMinor: newClients ? Math.round(marketingSpendMinor / newClients) : null,
    operatingProfitMinor: recognised - paymentFeesMinor - expensesMinor,
    serviceRevenue,
  };
}

/* ------------------------------------------------------------------ */
/* Forecasting                                                        */
/* ------------------------------------------------------------------ */

export const ScenarioAssumptionsSchema = z.object({
  discoveryCallsPerMonth: z.number().min(0),
  monthlyGrowthPct: z.number().min(-50).max(100),
  conversionRatePct: z.number().min(0).max(100),
  averageTransactionMinor: z.number().int().min(0),
  repeatRatePct: z.number().min(0).max(100),
  monthlyFixedCostsMinor: z.number().int().min(0),
  marketingSpendMinor: z.number().int().min(0),
  paymentFeePct: z.number().min(0).max(10),
});
export type ScenarioAssumptions = z.infer<typeof ScenarioAssumptionsSchema>;
export type ScenarioName = "conservative" | "base" | "growth";

/** Placeholder assumptions — EDITABLE in the Command Center and clearly not evidence of performance. */
export const DEFAULT_ASSUMPTIONS: Record<ScenarioName, ScenarioAssumptions> = {
  conservative: { discoveryCallsPerMonth: 6, monthlyGrowthPct: 5, conversionRatePct: 20, averageTransactionMinor: 33300, repeatRatePct: 10, monthlyFixedCostsMinor: 60000, marketingSpendMinor: 30000, paymentFeePct: 2 },
  base: { discoveryCallsPerMonth: 10, monthlyGrowthPct: 10, conversionRatePct: 30, averageTransactionMinor: 45000, repeatRatePct: 20, monthlyFixedCostsMinor: 80000, marketingSpendMinor: 50000, paymentFeePct: 2 },
  growth: { discoveryCallsPerMonth: 15, monthlyGrowthPct: 15, conversionRatePct: 35, averageTransactionMinor: 60000, repeatRatePct: 25, monthlyFixedCostsMinor: 120000, marketingSpendMinor: 100000, paymentFeePct: 2 },
};

export type ForecastMonth = { monthIndex: number; month: string; newClients: number; repeatClients: number; revenueMinor: number; costsMinor: number; profitMinor: number };
export type Forecast = { kind: "forecast"; scenario: ScenarioName; assumptions: ScenarioAssumptions; months: ForecastMonth[]; targetReachedMonth: Record<number, string | null> };

export function forecast(scenario: ScenarioName, a: ScenarioAssumptions, startMonth: string, months = 24): Forecast {
  ScenarioAssumptionsSchema.parse(a);
  const [y0, m0] = startMonth.split("-").map(Number) as [number, number];
  let cumulativeClients = 0;
  const out: ForecastMonth[] = [];
  for (let i = 0; i < months; i++) {
    const calls = a.discoveryCallsPerMonth * (1 + a.monthlyGrowthPct / 100) ** i;
    const newClients = calls * (a.conversionRatePct / 100);
    const repeatClients = cumulativeClients * (a.repeatRatePct / 100);
    cumulativeClients += newClients;
    const revenueMinor = Math.round((newClients + repeatClients) * a.averageTransactionMinor);
    const costsMinor = Math.round(a.monthlyFixedCostsMinor + a.marketingSpendMinor + revenueMinor * (a.paymentFeePct / 100));
    const d = new Date(Date.UTC(y0, m0 - 1 + i, 1));
    out.push({ monthIndex: i, month: monthOf(d), newClients: Math.round(newClients * 10) / 10, repeatClients: Math.round(repeatClients * 10) / 10, revenueMinor, costsMinor, profitMinor: revenueMinor - costsMinor });
  }
  const targetReachedMonth: Record<number, string | null> = {};
  for (const t of REVENUE_TARGETS_MINOR) targetReachedMonth[t] = out.find((m) => m.revenueMinor >= t)?.month ?? null;
  return { kind: "forecast", scenario, assumptions: a, months: out, targetReachedMonth };
}

export async function scenarioAssumptions(db: DB) {
  return getSetting<Record<ScenarioName, ScenarioAssumptions>>(db, "forecast_assumptions", DEFAULT_ASSUMPTIONS);
}

/* ------------------------------------------------------------------ */
/* Budget alerts                                                      */
/* ------------------------------------------------------------------ */

export type BudgetConfig = {
  startupBudgetCeilingMinor: number;
  monthlyMarketingBudgetMinor: number;
  monthlyExpenseThresholdMinor: number;
  refundRateAlertPct: number;
};
export const DEFAULT_BUDGET: BudgetConfig = {
  startupBudgetCeilingMinor: 1_000_000, // £10,000 proposed ceiling
  monthlyMarketingBudgetMinor: 50_000,
  monthlyExpenseThresholdMinor: 150_000,
  refundRateAlertPct: 10,
};

export type BudgetAlert = { rule: string; message: string };

export async function budgetAlerts(db: DB, month: string, now = new Date()): Promise<BudgetAlert[]> {
  const cfg = await getSetting<BudgetConfig>(db, "budget", DEFAULT_BUDGET);
  const a = await monthlyActuals(db, month, now);
  const alerts: BudgetAlert[] = [];
  const gbp = (m: number) => formatMoney(m);
  if (a.marketingSpendMinor > cfg.monthlyMarketingBudgetMinor) alerts.push({ rule: "marketing_over_budget", message: `Marketing spend ${gbp(a.marketingSpendMinor)} exceeds the approved ${gbp(cfg.monthlyMarketingBudgetMinor)} for ${month}.` });
  if (a.expensesMinor > cfg.monthlyExpenseThresholdMinor) alerts.push({ rule: "expenses_over_threshold", message: `Expenses ${gbp(a.expensesMinor)} exceed the ${gbp(cfg.monthlyExpenseThresholdMinor)} threshold for ${month}.` });
  if (a.cashCollectedMinor > 0 && (a.refundsMinor / a.cashCollectedMinor) * 100 > cfg.refundRateAlertPct) alerts.push({ rule: "refund_rate_high", message: `Refunds are ${Math.round((a.refundsMinor / a.cashCollectedMinor) * 100)}% of receipts in ${month}.` });
  const all = await db.select().from(expenses);
  const totalSpend = all.reduce((s, e) => s + e.amountMinor, 0);
  if (totalSpend > cfg.startupBudgetCeilingMinor) alerts.push({ rule: "startup_budget_exceeded", message: `Total recorded spend ${gbp(totalSpend)} exceeds the ${gbp(cfg.startupBudgetCeilingMinor)} startup ceiling.` });
  for (const ev of await db.select().from(programmeEvents)) {
    const cost = all.filter((e) => e.eventId === ev.id).reduce((s, e) => s + e.amountMinor, 0);
    if (ev.budgetMinor > 0 && cost > ev.budgetMinor) alerts.push({ rule: "event_over_budget", message: `${ev.title}: costs ${gbp(cost)} exceed budget ${gbp(ev.budgetMinor)}.` });
  }
  return alerts;
}

/** Event profitability: paid registration revenue vs recorded event costs (actuals only). */
export async function eventProfitability(db: DB) {
  const evs = await db.select().from(programmeEvents);
  const allExpenses = await db.select().from(expenses);
  const regs = await db.select().from(eventRegistrations);
  const pays = (await db.select().from(payments)).filter((p) => p.registrationId && p.status !== "failed" && p.status !== "pending");
  return evs.map((ev) => {
    const regIds = new Set(regs.filter((r) => r.eventId === ev.id).map((r) => r.id));
    const revenue = pays.filter((p) => regIds.has(p.registrationId!)).reduce((s, p) => s + p.amountMinor - p.refundedMinor, 0);
    const cost = allExpenses.filter((e) => e.eventId === ev.id).reduce((s, e) => s + e.amountMinor, 0);
    return { eventId: ev.id, title: ev.title, budgetMinor: ev.budgetMinor, costMinor: cost, paidRevenueMinor: revenue, contributionMinor: revenue - cost };
  });
}

export async function contactCount(db: DB) {
  return (await db.select({ id: contacts.id }).from(contacts)).length;
}

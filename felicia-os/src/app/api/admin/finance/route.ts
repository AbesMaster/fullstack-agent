import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, db, handle, requireUser } from "@/lib/server";
import { ScenarioAssumptionsSchema, monthOf, monthlyActuals } from "@/lib/finance/finance";
import { setSetting } from "@/lib/settings";
import { expenses } from "@/lib/db/schema";
import { newId } from "@/lib/util";
import { audit } from "@/lib/audit/audit";

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser("finance.view");
    const d = await db();
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, i) => monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1))));
    const rows = await Promise.all(months.map((m) => monthlyActuals(d, m)));
    if (new URL(req.url).searchParams.get("format") === "csv") {
      const cols = ["month", "cashCollectedMinor", "refundsMinor", "paymentFeesMinor", "netCashMinor", "recognisedRevenueMinor", "deferredRevenueMinor", "bookings", "discoveryCalls", "newClients", "returningClients", "expensesMinor", "marketingSpendMinor", "operatingProfitMinor"] as const;
      const csv = [`kind,${cols.join(",")}`, ...rows.map((r) => `actual,${cols.map((c) => r[c]).join(",")}`)].join("\n");
      return new NextResponse(csv, { headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="felicia-os-actuals-${months.at(-1)}.csv"` } });
    }
    return NextResponse.json({ kind: "actual", rows });
  });
}

const Body = z.object({
  assumptions: z.object({ conservative: ScenarioAssumptionsSchema, base: ScenarioAssumptionsSchema, growth: ScenarioAssumptionsSchema }).optional(),
  expense: z.object({ category: z.enum(["marketing", "software", "venue", "travel", "insurance", "professional_fees", "other"]), description: z.string().min(1).max(200), amountMinor: z.number().int().positive(), incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), eventId: z.string().optional() }).optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    await assertSameOrigin();
    const u = await requireUser("finance.edit");
    const b = Body.parse(await req.json());
    const d = await db();
    if (b.assumptions) {
      await setSetting(d, "forecast_assumptions", b.assumptions, `user:${u.id}`);
      await audit(d, { actor: `user:${u.id}`, action: "forecast.assumptions_updated" });
    }
    if (b.expense) {
      const id = newId("exp");
      await d.insert(expenses).values({ id, ...b.expense });
      await audit(d, { actor: `user:${u.id}`, action: "expense.recorded", target: id, metadata: { amountMinor: b.expense.amountMinor, category: b.expense.category } });
    }
    return NextResponse.json({ ok: true });
  });
}

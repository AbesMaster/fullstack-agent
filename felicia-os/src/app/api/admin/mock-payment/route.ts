import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/config/env";
import { assertSameOrigin, db } from "@/lib/server";
import { MockPaymentProvider, paymentProvider, signMockWebhook } from "@/lib/payments/provider";
import { applyPaymentEvent } from "@/lib/payments/processing";
import { bus } from "@/lib/agents/workflows";

/** DEVELOPMENT ONLY: produces a signed mock webhook exactly as a provider would. Disabled in production or when Stripe is configured. */
export async function POST(req: Request) {
  if (env().APP_ENV === "production" || !(paymentProvider() instanceof MockPaymentProvider)) return NextResponse.json({ error: "Not available" }, { status: 404 });
  await assertSameOrigin();
  const { reference, amountMinor } = await req.json();
  const id = randomUUID();
  const body = JSON.stringify({ kind: "payment_succeeded", providerEventId: `mock_evt_${id}`, providerRef: `mock_pi_${id}`, reference, amountMinor, feeMinor: Math.round(amountMinor * 0.015 + 20), currency: "GBP" });
  const provider = paymentProvider();
  const evt = provider.parseWebhook(body, signMockWebhook(body)); // same verification path as real webhooks
  const d = await db();
  await applyPaymentEvent(d, "mock", evt);
  await bus().drain(d);
  return NextResponse.json({ ok: true });
}

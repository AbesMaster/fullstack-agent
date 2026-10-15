import { NextResponse } from "next/server";
import { db } from "@/lib/server";
import { paymentProvider } from "@/lib/payments/provider";
import { applyPaymentEvent } from "@/lib/payments/processing";
import { bus } from "@/lib/agents/workflows";

/**
 * Payment provider webhooks. The RAW body is verified against the provider signature
 * before anything is trusted. Processing is idempotent; downstream work runs via the outbox.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const provider = paymentProvider();
  let evt;
  try {
    evt = provider.parseWebhook(raw, req.headers.get("stripe-signature") ?? req.headers.get("x-mock-signature"));
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    const d = await db();
    const r = await applyPaymentEvent(d, provider.name, evt);
    await bus().drain(d, { limit: 20 }).catch(() => undefined); // best-effort; the worker retries
    return NextResponse.json({ received: true, duplicate: !!r.duplicate });
  } catch (err) {
    console.error("[webhook] processing failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 }); // provider will retry
  }
}

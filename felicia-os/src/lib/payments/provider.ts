import { createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { env } from "../config/env";

export type CheckoutRequest = {
  reference: string; // booking or registration id
  description: string;
  amountMinor: number;
  currency: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
};

export type CheckoutSession = { provider: "stripe" | "mock"; sessionId: string; url: string };

/** Normalised webhook event — the rest of the system never sees provider-specific shapes. */
export type PaymentWebhookEvent =
  | { kind: "payment_succeeded"; providerEventId: string; providerRef: string; reference: string; amountMinor: number; feeMinor: number; currency: string }
  | { kind: "payment_failed"; providerEventId: string; providerRef: string; reference: string }
  | { kind: "refunded"; providerEventId: string; providerRef: string; refundedMinor: number }
  | { kind: "ignored"; providerEventId: string; type: string };

export interface PaymentProvider {
  readonly name: "stripe" | "mock";
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /** Verifies the signature against the RAW body. Throws on any mismatch. */
  parseWebhook(rawBody: string, signatureHeader: string | null): PaymentWebhookEvent;
  refund(providerRef: string, amountMinor: number, idempotencyKey: string): Promise<{ refundId: string }>;
}

/* ------------------------------------------------------------------ */
/* Stripe — hosted Checkout; card data never touches our servers.     */
/* ------------------------------------------------------------------ */

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  private stripe: Stripe;
  constructor(private secretKey: string, private webhookSecret: string) {
    this.stripe = new Stripe(secretKey);
  }

  /** Read-only launch check: key works, test or live mode, and a webhook points at this site. */
  async verifyConnection(appUrl: string) {
    await this.stripe.balance.retrieve();
    const hooks = await this.stripe.webhookEndpoints.list({ limit: 100 });
    const target = `${appUrl.replace(/\/$/, "")}/api/webhooks/payments`;
    const hook = hooks.data.find((h) => h.url === target && h.status === "enabled");
    return { mode: this.secretKey.startsWith("sk_live_") || this.secretKey.startsWith("rk_live_") ? ("live" as const) : ("test" as const), webhook: hook ? "enabled" : "missing", target };
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const s = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: req.customerEmail,
        client_reference_id: req.reference,
        metadata: { reference: req.reference },
        payment_intent_data: { metadata: { reference: req.reference } },
        line_items: [
          { quantity: 1, price_data: { currency: req.currency.toLowerCase(), unit_amount: req.amountMinor, product_data: { name: req.description } } },
        ],
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
      },
      { idempotencyKey: req.idempotencyKey },
    );
    if (!s.url) throw new Error("Stripe did not return a checkout URL");
    return { provider: "stripe", sessionId: s.id, url: s.url };
  }

  parseWebhook(rawBody: string, signatureHeader: string | null): PaymentWebhookEvent {
    if (!signatureHeader) throw new Error("Missing Stripe-Signature header");
    const evt = this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
    switch (evt.type) {
      case "checkout.session.completed": {
        const s = evt.data.object as Stripe.Checkout.Session;
        if (s.payment_status !== "paid") return { kind: "ignored", providerEventId: evt.id, type: `${evt.type}:${s.payment_status}` };
        return {
          kind: "payment_succeeded",
          providerEventId: evt.id,
          providerRef: typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? s.id),
          reference: s.client_reference_id ?? s.metadata?.reference ?? "",
          amountMinor: s.amount_total ?? 0,
          feeMinor: 0, // fees arrive on the balance transaction; reconciled by the finance job
          currency: (s.currency ?? "gbp").toUpperCase(),
        };
      }
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        const s = evt.data.object as Stripe.Checkout.Session;
        return { kind: "payment_failed", providerEventId: evt.id, providerRef: s.id, reference: s.client_reference_id ?? "" };
      }
      case "charge.refunded": {
        const c = evt.data.object as Stripe.Charge;
        return {
          kind: "refunded",
          providerEventId: evt.id,
          providerRef: typeof c.payment_intent === "string" ? c.payment_intent : (c.payment_intent?.id ?? c.id),
          refundedMinor: c.amount_refunded,
        };
      }
      default:
        return { kind: "ignored", providerEventId: evt.id, type: evt.type };
    }
  }

  async refund(providerRef: string, amountMinor: number, idempotencyKey: string) {
    const r = await this.stripe.refunds.create({ payment_intent: providerRef, amount: amountMinor }, { idempotencyKey });
    return { refundId: r.id };
  }
}

/* ------------------------------------------------------------------ */
/* Mock — for development, tests and the demo. Clearly labelled.      */
/* Uses the same "sign the raw body" contract as Stripe.              */
/* ------------------------------------------------------------------ */

export const MOCK_WEBHOOK_SECRET = "mock_whsec_development_only";

export function signMockWebhook(rawBody: string, secret = MOCK_WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;
  public refunds: { providerRef: string; amountMinor: number }[] = [];
  constructor(private secret = MOCK_WEBHOOK_SECRET, private toleranceSeconds = 300) {}

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const sessionId = `mock_cs_${req.idempotencyKey}`;
    const url = `${env().APP_URL}/book/mock-checkout?session=${encodeURIComponent(sessionId)}&ref=${encodeURIComponent(req.reference)}&amount=${req.amountMinor}`;
    return { provider: "mock", sessionId, url };
  }

  parseWebhook(rawBody: string, signatureHeader: string | null): PaymentWebhookEvent {
    if (!signatureHeader) throw new Error("Missing signature");
    const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=") as [string, string]));
    const t = Number(parts.t);
    if (!t || Math.abs(Date.now() / 1000 - t) > this.toleranceSeconds) throw new Error("Signature timestamp outside tolerance");
    const expected = createHmac("sha256", this.secret).update(`${t}.${rawBody}`).digest();
    const given = Buffer.from(parts.v1 ?? "", "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error("Invalid signature");
    return JSON.parse(rawBody) as PaymentWebhookEvent;
  }

  async refund(providerRef: string, amountMinor: number) {
    this.refunds.push({ providerRef, amountMinor });
    return { refundId: `mock_re_${this.refunds.length}` };
  }
}

let override: PaymentProvider | undefined;
export function setPaymentProviderForTests(p: PaymentProvider | undefined) {
  override = p;
}

export function paymentProvider(): PaymentProvider {
  if (override) return override;
  const e = env();
  if (e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET) return new StripeProvider(e.STRIPE_SECRET_KEY, e.STRIPE_WEBHOOK_SECRET);
  if (e.APP_ENV === "production") throw new Error("Stripe credentials are required in production");
  return new MockPaymentProvider();
}

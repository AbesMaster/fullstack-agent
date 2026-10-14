import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { bookings, eventRegistrations, payments, refundRequests } from "../db/schema";
import { publish } from "../events/bus";
import { audit } from "../audit/audit";
import { newId } from "../util";
import { requestApproval } from "../agents/controls";
import type { PaymentWebhookEvent } from "./provider";

/**
 * Applies a VERIFIED, normalised webhook event. Idempotent: replays of the same
 * provider event (or a second event for the same charge) never double-record.
 */
export async function applyPaymentEvent(db: DB, provider: "stripe" | "mock", evt: PaymentWebhookEvent) {
  const correlationId = newId("cor");
  await audit(db, { actor: `webhook:${provider}`, action: `payment.webhook.${evt.kind}`, target: evt.providerEventId, correlationId });

  if (evt.kind === "payment_succeeded") {
    const isBooking = evt.reference.startsWith("bkg_");
    const isRegistration = evt.reference.startsWith("reg_");
    if (!isBooking && !isRegistration) throw new Error(`Unknown payment reference ${evt.reference}`);

    if (isBooking) {
      const [b] = await db.select().from(bookings).where(eq(bookings.id, evt.reference));
      if (!b) throw new Error(`Booking ${evt.reference} not found`);
      if (evt.amountMinor !== b.amountMinor) {
        await audit(db, { actor: `webhook:${provider}`, action: "payment.amount_mismatch", target: b.id, correlationId, metadata: { expected: b.amountMinor, got: evt.amountMinor } });
      }
    }

    const paymentId = newId("pay");
    const inserted = await db
      .insert(payments)
      .values({
        id: paymentId,
        provider,
        providerRef: evt.providerRef,
        bookingId: isBooking ? evt.reference : null,
        registrationId: isRegistration ? evt.reference : null,
        amountMinor: evt.amountMinor,
        feeMinor: evt.feeMinor,
        currency: evt.currency,
        status: "succeeded",
        paidAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: payments.id });
    if (!inserted[0]) return { duplicate: true };

    await publish(
      db,
      "PAYMENT_CONFIRMED",
      { paymentId, bookingId: isBooking ? evt.reference : null, registrationId: isRegistration ? evt.reference : null },
      { correlationId, idempotencyKey: `${provider}:${evt.providerRef}` },
    );
    return { duplicate: false, paymentId };
  }

  if (evt.kind === "payment_failed") {
    if (evt.reference.startsWith("bkg_")) {
      await publish(db, "PAYMENT_FAILED", { paymentId: evt.providerRef, bookingId: evt.reference }, { correlationId, idempotencyKey: evt.providerEventId });
    }
    return { duplicate: false };
  }

  if (evt.kind === "refunded") {
    const [p] = await db.select().from(payments).where(and(eq(payments.provider, provider), eq(payments.providerRef, evt.providerRef)));
    if (p) {
      await db
        .update(payments)
        .set({ refundedMinor: evt.refundedMinor, status: evt.refundedMinor >= p.amountMinor ? "refunded" : "partially_refunded" })
        .where(eq(payments.id, p.id));
    }
    return { duplicate: false };
  }
  return { duplicate: false, ignored: true };
}

/** Booking confirmation after payment (Payments agent step). */
export async function confirmPaidBooking(db: DB, bookingId: string, correlationId: string) {
  const [b] = await db
    .update(bookings)
    .set({ status: "confirmed" })
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, "pending_payment")))
    .returning();
  if (b) await publish(db, "BOOKING_CONFIRMED", { bookingId }, { correlationId, idempotencyKey: bookingId });
  return !!b;
}

export async function confirmPaidRegistration(db: DB, registrationId: string) {
  await db.update(eventRegistrations).set({ status: "confirmed" }).where(eq(eventRegistrations.id, registrationId));
}

/**
 * Refund requests are always reviewed: this records the request and an approval.
 * Money only moves in executeApproved() after the owner/admin approves.
 */
export async function requestRefund(db: DB, paymentId: string, amountMinor: number, reason: string, agentId = "support") {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p) throw new Error("Payment not found");
  if (amountMinor <= 0 || amountMinor > p.amountMinor - p.refundedMinor) throw new Error("Refund amount exceeds refundable balance");
  const id = newId("rfr");
  await db.insert(refundRequests).values({ id, paymentId, amountMinor, reason });
  const approvalId = await requestApproval(db, agentId, "payments.refund", `Refund £${(amountMinor / 100).toFixed(2)} — ${reason}`, { refundRequestId: id, paymentId, amountMinor });
  await db.update(refundRequests).set({ approvalId }).where(eq(refundRequests.id, id));
  await publish(db, "REFUND_REQUESTED", { refundRequestId: id }, { correlationId: newId("cor"), idempotencyKey: id });
  return { refundRequestId: id, approvalId };
}

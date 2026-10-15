import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { harness, MONDAY, type Harness } from "./helpers";
import { requestBooking } from "@/lib/booking/booking";
import { signMockWebhook, type PaymentWebhookEvent } from "@/lib/payments/provider";
import { applyPaymentEvent, requestRefund } from "@/lib/payments/processing";
import { approvals, bookings, payments, refundRequests } from "@/lib/db/schema";
import { decideAndDispatch } from "@/lib/agents/workflows";
import { PermissionDenied } from "@/lib/agents/controls";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

async function paidBooking() {
  const r = await requestBooking(
    h.db,
    { serviceId: "signature-private-session", startsAt: new Date("2026-01-07T10:00:00Z"), name: "Fictional Payer", email: "payer@example.test", clientTimezone: "Europe/London", acceptedTerms: true },
    "pay-1",
    MONDAY,
  );
  return r.bookingId;
}

const success = (bookingId: string, ref = "pi_test_1"): PaymentWebhookEvent => ({ kind: "payment_succeeded", providerEventId: `evt_${ref}`, providerRef: ref, reference: bookingId, amountMinor: 33300, feeMinor: 500, currency: "GBP" });

describe("webhook signature verification", () => {
  it("accepts a valid signature and rejects tampering, missing and stale signatures", () => {
    const body = JSON.stringify(success("bkg_x"));
    expect(h.payments.parseWebhook(body, signMockWebhook(body)).kind).toBe("payment_succeeded");
    expect(() => h.payments.parseWebhook(body.replace("33300", "1"), signMockWebhook(body))).toThrow(/Invalid signature/);
    expect(() => h.payments.parseWebhook(body, null)).toThrow();
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(() => h.payments.parseWebhook(body, signMockWebhook(body, undefined, old))).toThrow(/tolerance/);
  });
});

describe("payment confirmation workflow", () => {
  it("confirms the booking only after a verified payment, and emails a receipt", async () => {
    const id = await paidBooking();
    await h.drainAll();
    expect((await h.db.select().from(bookings))[0]!.status).toBe("pending_payment");
    await applyPaymentEvent(h.db, "mock", success(id));
    await h.drainAll();
    const [b] = await h.db.select().from(bookings).where(eq(bookings.id, id));
    expect(b!.status).toBe("confirmed");
    expect(h.email.outbox.some((m) => m.subject === "Payment received — thank you")).toBe(true);
    expect(h.email.outbox.some((m) => m.subject === "Preparing for your session")).toBe(true);
    expect(h.crm.deals).toHaveLength(1);
  });

  it("never double-records a replayed webhook", async () => {
    const id = await paidBooking();
    await applyPaymentEvent(h.db, "mock", success(id));
    const again = await applyPaymentEvent(h.db, "mock", success(id));
    expect(again.duplicate).toBe(true);
    await h.drainAll();
    expect(await h.db.select().from(payments)).toHaveLength(1);
    expect(h.email.outbox.filter((m) => m.subject === "Payment received — thank you")).toHaveLength(1);
  });
});

describe("refunds require approval", () => {
  it("records a request + approval, moves no money until approved, then refunds exactly once", async () => {
    const id = await paidBooking();
    await applyPaymentEvent(h.db, "mock", success(id));
    await h.drainAll();
    const [p] = await h.db.select().from(payments);
    const { approvalId } = await requestRefund(h.db, p!.id, 33300, "Client unwell (fictional)");
    await h.drainAll();
    expect(h.payments.refunds).toHaveLength(0);

    await expect(decideAndDispatch(h.db, approvalId, "approved", { id: "usr_staff", role: "staff" })).rejects.toBeInstanceOf(PermissionDenied);

    await decideAndDispatch(h.db, approvalId, "approved", { id: "usr_owner", role: "owner" });
    await h.drainAll();
    await h.drainAll();
    expect(h.payments.refunds).toEqual([{ providerRef: "pi_test_1", amountMinor: 33300 }]);
    const [after] = await h.db.select().from(payments);
    expect(after!.status).toBe("refunded");
    const [rr] = await h.db.select().from(refundRequests);
    expect(rr!.status).toBe("processed");
    const [a] = await h.db.select().from(approvals);
    expect(a!.decidedBy).toBe("usr_owner");
  });

  it("rejecting a refund marks it rejected and moves no money", async () => {
    const id = await paidBooking();
    await applyPaymentEvent(h.db, "mock", success(id));
    await h.drainAll();
    const [p] = await h.db.select().from(payments);
    const { approvalId } = await requestRefund(h.db, p!.id, 1000, "partial (fictional)");
    await decideAndDispatch(h.db, approvalId, "rejected", { id: "usr_owner", role: "owner" });
    await h.drainAll();
    expect(h.payments.refunds).toHaveLength(0);
    expect((await h.db.select().from(refundRequests))[0]!.status).toBe("rejected");
  });

  it("refuses refunds above the refundable balance", async () => {
    const id = await paidBooking();
    await applyPaymentEvent(h.db, "mock", success(id));
    const [p] = await h.db.select().from(payments);
    await expect(requestRefund(h.db, p!.id, 99999, "too much")).rejects.toThrow(/exceeds/);
  });
});

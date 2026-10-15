import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { harness, MONDAY, type Harness } from "./helpers";
import { requestBooking } from "@/lib/booking/booking";
import { applyPaymentEvent } from "@/lib/payments/processing";
import { agentTasks, clientLoginTokens, contacts, emailSuppressions, enquiries } from "@/lib/db/schema";
import { consumeSignInLink, createClientSession, portalOverview, readClientSession, requestChange, requestSignInLink, setMarketingPreference } from "@/lib/portal/portal";
import { createSessionToken, readSessionToken } from "@/lib/auth/auth";
import { createEnquiry } from "@/lib/booking/booking";
import { sendTemplate } from "@/lib/email/send";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const linkFromEmail = () => {
  const m = h.email.outbox.filter((e) => e.subject === "Your sign-in link").at(-1)!;
  return new URL(m.text.match(/https?:\/\/\S+/)![0]).searchParams.get("t")!;
};

async function bookedClient(email = "client@example.test", start = "2026-01-06T10:00:00Z", key = "b1") {
  const r = await requestBooking(h.db, { serviceId: "discovery-call", startsAt: new Date(start), name: "Portal Client (test)", email, clientTimezone: "Europe/London", acceptedTerms: true }, key, MONDAY);
  await h.drainAll();
  return r.bookingId;
}

describe("sign-in links", () => {
  it("emails a single-use link to clients and stores only its hash", async () => {
    await bookedClient();
    expect(await requestSignInLink(h.db, "Client@Example.test")).toBe("sent");
    const token = linkFromEmail();
    const [row] = await h.db.select().from(clientLoginTokens);
    expect(row!.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
    const contactId = await consumeSignInLink(h.db, token);
    expect(contactId).toBeTruthy();
    expect(await consumeSignInLink(h.db, token)).toBeNull(); // single use
  });

  it("sends nothing for unknown emails or people who only enquired", async () => {
    await createEnquiry(h.db, { name: "Enquirer (test)", email: "enq@example.test", message: "hello" }, "e1");
    await h.drainAll();
    const before = h.email.outbox.length;
    expect(await requestSignInLink(h.db, "nobody@example.test")).toBe("not_found");
    expect(await requestSignInLink(h.db, "enq@example.test")).toBe("not_found");
    expect(h.email.outbox.length).toBe(before);
  });

  it("links expire after 15 minutes, and requests are limited per email", async () => {
    await bookedClient();
    const t0 = new Date();
    await requestSignInLink(h.db, "client@example.test", t0);
    const token = linkFromEmail();
    expect(await consumeSignInLink(h.db, token, new Date(t0.getTime() + 16 * 60_000))).toBeNull();
    await requestSignInLink(h.db, "client@example.test", t0);
    await requestSignInLink(h.db, "client@example.test", t0);
    expect(await requestSignInLink(h.db, "client@example.test", t0)).toBe("throttled");
    expect(await consumeSignInLink(h.db, "not-a-real-token")).toBeNull();
  });

  it("client and admin sessions can't be swapped", async () => {
    const clientToken = await createClientSession("con_x");
    expect(await readClientSession(clientToken)).toBe("con_x");
    expect(await readSessionToken(clientToken)).toBeNull();
    const adminToken = await createSessionToken({ id: "usr_1", email: "a@example.test", name: "A", role: "owner" }, true);
    expect(await readClientSession(adminToken)).toBeNull();
  });
});

describe("client area", () => {
  it("shows only the client's own bookings, with join links for upcoming online sessions and payments", async () => {
    const mine = await bookedClient();
    await bookedClient("someone-else@example.test", "2026-01-07T10:00:00Z", "b2");
    const paid = await requestBooking(h.db, { serviceId: "signature-private-session", startsAt: new Date("2026-01-08T10:00:00Z"), name: "Portal Client (test)", email: "client@example.test", clientTimezone: "Europe/London", acceptedTerms: true }, "b3", MONDAY);
    await applyPaymentEvent(h.db, "mock", { kind: "payment_succeeded", providerEventId: "e1", providerRef: "pi_1", reference: paid.bookingId, amountMinor: 33300, feeMinor: 0, currency: "GBP" });
    await h.drainAll();
    const [c] = await h.db.select().from(contacts).where(eq(contacts.email, "client@example.test"));
    const o = (await portalOverview(h.db, c!.id, MONDAY))!;
    expect(o.upcoming.map((s) => s.id).sort()).toEqual([mine, paid.bookingId].sort());
    expect(o.upcoming.every((s) => s.joinUrl?.includes("mock-zoom"))).toBe(true);
    expect(o.upcoming.find((s) => s.id === paid.bookingId)!.welcomeFormUrl).toMatch(/^\/intake\?b=/);
    expect(o.payments).toHaveLength(1);
    expect(o.payments[0]!.for).toBe("Signature Private Session");
    expect(JSON.stringify(o)).not.toContain("someone-else");

    // After the session the join link is no longer shown.
    const later = (await portalOverview(h.db, c!.id, new Date("2026-02-01T00:00:00Z")))!;
    expect(later.upcoming).toHaveLength(0);
    expect(later.past.every((s) => s.joinUrl === null)).toBe(true);
  });

  it("change requests go to Felicia and can't touch someone else's booking", async () => {
    const mine = await bookedClient();
    const theirs = await bookedClient("other@example.test", "2026-01-07T10:00:00Z", "b2");
    const [c] = await h.db.select().from(contacts).where(eq(contacts.email, "client@example.test"));
    await requestChange(h.db, c!.id, { bookingId: mine, kind: "reschedule", message: "Thursday would suit me better" });
    const [enq] = await h.db.select().from(enquiries).where(eq(enquiries.channel, "portal"));
    expect(enq!.message).toContain("Thursday would suit me better");
    expect((await h.db.select().from(agentTasks).where(eq(agentTasks.kind, "owner_attention"))).length).toBe(1);
    await expect(requestChange(h.db, c!.id, { bookingId: theirs, kind: "cancel" })).rejects.toThrow(/can't be changed/);
  });

  it("email preference changes take effect for marketing only", async () => {
    await bookedClient();
    const [c] = await h.db.select().from(contacts).where(eq(contacts.email, "client@example.test"));
    await setMarketingPreference(h.db, c!.id, true);
    expect(await sendTemplate(h.db, "newsletter_welcome", "client@example.test", { name: "x" })).toBe("mock_sent");
    await setMarketingPreference(h.db, c!.id, false);
    expect(await sendTemplate(h.db, "newsletter_welcome", "client@example.test", { name: "x" })).toBe("suppressed");
    expect(await sendTemplate(h.db, "rescheduling_confirmation", "client@example.test", { name: "x", service: "S", when: "Tue" })).toBe("mock_sent");
    expect(await h.db.select().from(emailSuppressions)).toHaveLength(1);
    await setMarketingPreference(h.db, c!.id, true);
    expect(await h.db.select().from(emailSuppressions)).toHaveLength(0);
  });
});

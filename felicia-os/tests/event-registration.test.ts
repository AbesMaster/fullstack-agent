import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { harness, type Harness } from "./helpers";
import { cancelRegistration, createEvent, EventError, expireRegistrationHolds, getEvent, publicEvents, registerForEvent, seatsTaken, updateEvent } from "@/lib/programme/events";
import { applyPaymentEvent } from "@/lib/payments/processing";
import { agentTasks, eventRegistrations, payments } from "@/lib/db/schema";
import { sendEventReminders } from "@/lib/agents/schedule";
import { eventProfitability } from "@/lib/finance/finance";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const NOW = new Date("2026-03-02T09:00:00Z");
const base = { title: "Breath & Stillness Workshop (test)", location: "Bath, UK (test venue)", startsAt: new Date("2026-03-21T10:00:00Z"), endsAt: new Date("2026-03-21T14:00:00Z"), status: "open" as const };
const who = (n: number, over: Record<string, unknown> = {}) => ({ name: `Attendee ${n} (test)`, email: `attendee${n}@example.test`, acceptedTerms: true as const, ...over });

describe("event registration", () => {
  it("free events confirm immediately, email the attendee and sync the CRM", async () => {
    const id = await createEvent(h.db, { ...base, capacity: 10, priceMinor: 0 }, "user:t");
    const r = await registerForEvent(h.db, { eventId: id, ...who(1) }, NOW);
    expect(r.status).toBe("confirmed");
    expect(r.checkoutUrl).toBeNull();
    await h.drainAll();
    expect(h.email.outbox.map((m) => m.subject)).toContain(`You're registered: ${base.title}`);
    expect(h.crm.contacts.get("attendee1@example.test")).toBeTruthy();
  });

  it("paid events hold a place, then confirm only after a verified payment", async () => {
    const id = await createEvent(h.db, { ...base, capacity: 10, priceMinor: 11100 }, "user:t");
    const r = await registerForEvent(h.db, { eventId: id, ...who(1) }, NOW);
    expect(r.status).toBe("pending_payment");
    expect(r.checkoutUrl).toContain("mock-checkout");
    expect(await seatsTaken(h.db, id, NOW)).toBe(1);
    await applyPaymentEvent(h.db, "mock", { kind: "payment_succeeded", providerEventId: "e1", providerRef: "pi_1", reference: r.registrationId, amountMinor: 11100, feeMinor: 0, currency: "GBP" });
    await h.drainAll();
    const [reg] = await h.db.select().from(eventRegistrations);
    expect(reg!.status).toBe("confirmed");
    expect(h.email.outbox.filter((m) => m.subject.startsWith("You're registered"))).toHaveLength(1);
    const [p] = await h.db.select().from(payments);
    expect(p!.registrationId).toBe(r.registrationId);
    const prof = await eventProfitability(h.db);
    expect(prof[0]!.paidRevenueMinor).toBe(11100);
  });

  it("never sells more places than capacity, and marks the event full", async () => {
    const id = await createEvent(h.db, { ...base, capacity: 2, priceMinor: 0 }, "user:t");
    await registerForEvent(h.db, { eventId: id, ...who(1) }, NOW);
    await registerForEvent(h.db, { eventId: id, ...who(2) }, NOW);
    expect((await getEvent(h.db, id))!.status).toBe("full");
    await expect(registerForEvent(h.db, { eventId: id, ...who(3) }, NOW)).rejects.toMatchObject({ code: "full" });
    expect((await h.db.select().from(eventRegistrations)).filter((r) => r.status === "confirmed")).toHaveLength(2);
  });

  it("a person can't take two places; retrying an unpaid checkout reuses their hold", async () => {
    const free = await createEvent(h.db, { ...base, capacity: 5, priceMinor: 0 }, "user:t");
    await registerForEvent(h.db, { eventId: free, ...who(1) }, NOW);
    await expect(registerForEvent(h.db, { eventId: free, ...who(1, { email: "ATTENDEE1@example.test" }) }, NOW)).rejects.toMatchObject({ code: "already_registered" });

    const paid = await createEvent(h.db, { ...base, capacity: 5, priceMinor: 4400 }, "user:t");
    const a = await registerForEvent(h.db, { eventId: paid, ...who(2) }, NOW);
    const b = await registerForEvent(h.db, { eventId: paid, ...who(2) }, new Date(NOW.getTime() + 5 * 60_000));
    expect(b.registrationId).toBe(a.registrationId);
    expect(await seatsTaken(h.db, paid, NOW)).toBe(1);
  });

  it("releases unpaid holds after 30 minutes so the place can be resold", async () => {
    const id = await createEvent(h.db, { ...base, capacity: 1, priceMinor: 4400 }, "user:t");
    await registerForEvent(h.db, { eventId: id, ...who(1) }, NOW);
    await expect(registerForEvent(h.db, { eventId: id, ...who(2) }, NOW)).rejects.toMatchObject({ code: "full" });
    const later = new Date(NOW.getTime() + 31 * 60_000);
    expect((await expireRegistrationHolds(h.db, later)).expired).toBe(1);
    const r = await registerForEvent(h.db, { eventId: id, ...who(2) }, later);
    expect(r.status).toBe("pending_payment");
  });

  it("honours a payment that arrives after the hold expired, and alerts Felicia if over capacity", async () => {
    const id = await createEvent(h.db, { ...base, capacity: 1, priceMinor: 4400 }, "user:t");
    const first = await registerForEvent(h.db, { eventId: id, ...who(1) }, NOW);
    const later = new Date(NOW.getTime() + 31 * 60_000);
    await expireRegistrationHolds(h.db, later);
    const second = await registerForEvent(h.db, { eventId: id, ...who(2) }, later);
    await applyPaymentEvent(h.db, "mock", { kind: "payment_succeeded", providerEventId: "e2", providerRef: "pi_2", reference: second.registrationId, amountMinor: 4400, feeMinor: 0, currency: "GBP" });
    await applyPaymentEvent(h.db, "mock", { kind: "payment_succeeded", providerEventId: "e1", providerRef: "pi_1", reference: first.registrationId, amountMinor: 4400, feeMinor: 0, currency: "GBP" });
    await h.drainAll();
    expect((await h.db.select().from(eventRegistrations)).every((r) => r.status === "confirmed")).toBe(true);
    const alerts = await h.db.select().from(agentTasks).where(eq(agentTasks.kind, "owner_attention"));
    expect(alerts).toHaveLength(1);
  });

  it("breathwork events require the health acknowledgment and include the health note", async () => {
    const id = await createEvent(h.db, { ...base, capacity: 5, priceMinor: 0, includesBreathwork: true }, "user:t");
    await expect(registerForEvent(h.db, { eventId: id, ...who(1) }, NOW)).rejects.toBeInstanceOf(EventError);
    await registerForEvent(h.db, { eventId: id, ...who(1, { healthAcknowledged: true }) }, NOW);
    await h.drainAll();
    expect(h.email.outbox.at(-1)!.text).toContain("This event includes breathwork");
  });

  it("only open, upcoming events are public; registration closes for draft and past events", async () => {
    const draft = await createEvent(h.db, { ...base, capacity: 5, priceMinor: 0, status: "planning" }, "user:t");
    const open = await createEvent(h.db, { ...base, capacity: 5, priceMinor: 0 }, "user:t");
    expect((await publicEvents(h.db, NOW)).map((e) => e.id)).toEqual([open]);
    await expect(registerForEvent(h.db, { eventId: draft, ...who(1) }, NOW)).rejects.toMatchObject({ code: "unavailable" });
    await expect(registerForEvent(h.db, { eventId: open, ...who(1) }, new Date("2026-04-01T00:00:00Z"))).rejects.toMatchObject({ code: "unavailable" });
  });

  it("admin edits are validated; capacity can't drop below confirmed places; cancelling frees a place", async () => {
    const id = await createEvent(h.db, { ...base, capacity: 2, priceMinor: 0 }, "user:t");
    const r = await registerForEvent(h.db, { eventId: id, ...who(1) }, NOW);
    await registerForEvent(h.db, { eventId: id, ...who(2) }, NOW);
    await expect(updateEvent(h.db, id, { capacity: 1 }, "user:t")).rejects.toThrow(/can't go below/);
    await expect(createEvent(h.db, { ...base, endsAt: new Date("2026-03-20T10:00:00Z"), capacity: 1, priceMinor: 0 }, "user:t")).rejects.toThrow();
    await cancelRegistration(h.db, r.registrationId, "user:t", "client asked");
    expect((await getEvent(h.db, id))!.status).toBe("open");
    await updateEvent(h.db, id, { capacity: 3 }, "user:t");
    expect((await getEvent(h.db, id))!.capacity).toBe(3);
  });

  it("sends one reminder to confirmed attendees the day before", async () => {
    const id = await createEvent(h.db, { ...base, capacity: 5, priceMinor: 0 }, "user:t");
    await registerForEvent(h.db, { eventId: id, ...who(1) }, NOW);
    const dayBefore = new Date(base.startsAt.getTime() - 24 * 3600_000);
    expect((await sendEventReminders(h.db, dayBefore)).sent).toBe(1);
    expect((await sendEventReminders(h.db, dayBefore)).sent).toBe(0);
  });
});

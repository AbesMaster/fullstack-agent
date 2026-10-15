import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { harness, MONDAY, type Harness } from "./helpers";
import { availableSlots, BookingError, cancelBooking, requestBooking, rescheduleBooking } from "@/lib/booking/booking";
import { getService } from "@/lib/services/catalogue";
import { bookings, contacts } from "@/lib/db/schema";
import { zonedTimeToUtc, wallClock } from "@/lib/booking/time";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const req = (startsAt: Date, over: Record<string, unknown> = {}) => ({
  serviceId: "discovery-call",
  startsAt,
  name: "Test Client (fictional)",
  email: "client@example.test",
  clientTimezone: "Europe/London",
  acceptedTerms: true as const,
  ...over,
});

describe("time zones", () => {
  it("converts London wall-clock to UTC across DST", () => {
    expect(zonedTimeToUtc(2026, 1, 5, 9, 0, "Europe/London").toISOString()).toBe("2026-01-05T09:00:00.000Z");
    expect(zonedTimeToUtc(2026, 7, 6, 9, 0, "Europe/London").toISOString()).toBe("2026-07-06T08:00:00.000Z");
    expect(zonedTimeToUtc(2026, 7, 6, 9, 0, "Asia/Qatar").toISOString()).toBe("2026-07-06T06:00:00.000Z");
    expect(wallClock(new Date("2026-07-06T08:00:00Z"), "Europe/London").hour).toBe(9);
  });
});

describe("availability", () => {
  it("respects minimum notice, working days and hours", async () => {
    const s = (await getService(h.db, "discovery-call"))!;
    const slots = await availableSlots(h.db, s, { now: MONDAY, days: 7 });
    expect(slots.length).toBeGreaterThan(0);
    const earliest = MONDAY.getTime() + s.bookingRules.minNoticeHours * 3600_000;
    for (const slot of slots) {
      expect(slot.start.getTime()).toBeGreaterThanOrEqual(earliest);
      const wc = wallClock(slot.start, "Europe/London");
      expect([1, 2, 3, 4, 5]).toContain(wc.weekday);
      expect(wc.hour).toBeGreaterThanOrEqual(9);
      expect(slot.end.getTime() - slot.start.getTime()).toBe(20 * 60_000);
    }
  });

  it("excludes busy time from the external calendar (with buffer)", async () => {
    const s = (await getService(h.db, "personal-alignment-session"))!;
    const busyStart = new Date("2026-01-07T10:00:00Z");
    h.calendar.externalBusy.push({ start: busyStart, end: new Date("2026-01-07T11:00:00Z") });
    const slots = await availableSlots(h.db, s, { now: MONDAY, days: 5 });
    // 60-minute session + 30-minute buffer: 09:00 (ends 10:00 +30 buffer) clashes, 11:30 is first free after.
    const onWed = slots.filter((x) => x.start.toISOString().startsWith("2026-01-07"));
    expect(onWed.some((x) => x.start.toISOString() === "2026-01-07T09:00:00.000Z")).toBe(false);
    expect(onWed.some((x) => x.start.toISOString() === "2026-01-07T10:30:00.000Z")).toBe(false);
    expect(onWed.some((x) => x.start.toISOString() === "2026-01-07T11:30:00.000Z")).toBe(true);
  });
});

describe("booking flow", () => {
  it("confirms a complimentary discovery call and runs the downstream workflow", async () => {
    const slot = new Date("2026-01-06T10:00:00Z");
    const r = await requestBooking(h.db, req(slot), "idem-1", MONDAY);
    expect(r.status).toBe("confirmed");
    expect(r.checkoutUrl).toBeNull();
    await h.drainAll();
    const [b] = await h.db.select().from(bookings).where(eq(bookings.id, r.bookingId));
    expect(b!.calendarEventId).toBeTruthy();
    expect(h.calendar.events.size).toBe(1);
    expect(h.email.outbox.map((m) => m.subject)).toContain("Your discovery call is confirmed");
    const [c] = await h.db.select().from(contacts);
    expect(c!.lifecycleStage).toBe("discovery");
    expect(h.crm.contacts.get("client@example.test")).toBeTruthy();
  });

  it("is idempotent: the same key never creates a second booking", async () => {
    const slot = new Date("2026-01-06T10:00:00Z");
    const a = await requestBooking(h.db, req(slot), "idem-dup", MONDAY);
    const b = await requestBooking(h.db, req(slot), "idem-dup", MONDAY);
    expect(b.bookingId).toBe(a.bookingId);
    expect(b.duplicate).toBe(true);
    expect((await h.db.select().from(bookings)).length).toBe(1);
  });

  it("prevents double booking of the same slot", async () => {
    const slot = new Date("2026-01-06T10:00:00Z");
    await requestBooking(h.db, req(slot), "a", MONDAY);
    await expect(requestBooking(h.db, req(slot, { email: "other@example.test" }), "b", MONDAY)).rejects.toBeInstanceOf(BookingError);
  });

  it("rejects times that are not offered slots", async () => {
    await expect(requestBooking(h.db, req(new Date("2026-01-10T10:00:00Z")), "sat", MONDAY)).rejects.toThrow(/no longer available/);
  });

  it("requires a discovery call before premium experiences", async () => {
    await expect(
      requestBooking(h.db, req(new Date("2026-01-07T10:00:00Z"), { serviceId: "premium-private-experience" }), "p", MONDAY),
    ).rejects.toMatchObject({ code: "requires_discovery" });
  });

  it("creates a hosted checkout for paid sessions and holds them as pending", async () => {
    const r = await requestBooking(h.db, req(new Date("2026-01-07T10:00:00Z"), { serviceId: "signature-private-session" }), "paid", MONDAY);
    expect(r.status).toBe("pending_payment");
    expect(r.checkoutUrl).toContain("mock-checkout");
    const [b] = await h.db.select().from(bookings);
    expect(b!.amountMinor).toBe(33300);
  });

  it("cancels and reschedules with calendar + email updates", async () => {
    const r = await requestBooking(h.db, req(new Date("2026-01-06T10:00:00Z")), "c1", MONDAY);
    await h.drainAll();
    await rescheduleBooking(h.db, r.bookingId, new Date("2026-01-08T13:00:00Z"), "user:test", MONDAY);
    await h.drainAll();
    const [b] = await h.db.select().from(bookings);
    expect(b!.startsAt.toISOString()).toBe("2026-01-08T13:00:00.000Z");
    expect(h.email.outbox.some((m) => m.subject === "Your session has been rescheduled")).toBe(true);
    await cancelBooking(h.db, r.bookingId, "user:test", "client request");
    await h.drainAll();
    expect(h.calendar.events.size).toBe(0);
    expect(h.email.outbox.some((m) => m.subject === "Your booking has been cancelled")).toBe(true);
  });
});

describe("admin date inputs", () => {
  it("round-trips UK wall-clock values regardless of server time zone", async () => {
    const { fromZonedInputValue, toZonedInputValue } = await import("@/lib/booking/time");
    expect(fromZonedInputValue("2026-07-04T10:00").toISOString()).toBe("2026-07-04T09:00:00.000Z");
    expect(fromZonedInputValue("2026-01-04T10:00").toISOString()).toBe("2026-01-04T10:00:00.000Z");
    expect(toZonedInputValue(new Date("2026-07-04T09:00:00Z"))).toBe("2026-07-04T10:00");
    expect(() => fromZonedInputValue("tomorrow")).toThrow();
  });
});

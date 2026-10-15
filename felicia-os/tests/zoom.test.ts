import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { harness, MONDAY, type Harness } from "./helpers";
import { cancelBooking, requestBooking, rescheduleBooking } from "@/lib/booking/booking";
import { bookings, programmeEvents } from "@/lib/db/schema";
import { ZoomProvider } from "@/lib/video/provider";
import { createEvent, registerForEvent, updateEvent } from "@/lib/programme/events";
import { sendReminders } from "@/lib/agents/schedule";
import { backoffMs } from "@/lib/events/bus";
import { applyPaymentEvent } from "@/lib/payments/processing";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const book = (over: Record<string, unknown> = {}, key = "k1") =>
  requestBooking(h.db, { serviceId: "discovery-call", startsAt: new Date("2026-01-06T10:00:00Z"), name: "Zoom Client (test)", email: "zoom@example.test", clientTimezone: "Europe/London", acceptedTerms: true, ...over }, key, MONDAY);
const lastEmail = () => h.email.outbox.at(-1)!;

describe("Zoom for online sessions", () => {
  it("creates one meeting, puts the link in the confirmation and on Felicia's calendar, never the host link", async () => {
    const r = await book();
    await h.drainAll();
    const [b] = await h.db.select().from(bookings).where(eq(bookings.id, r.bookingId));
    expect(b!.attendanceMode).toBe("online");
    expect(b!.videoJoinUrl).toMatch(/^https:\/\/example\.invalid\/mock-zoom\//);
    expect(h.video.meetings.size).toBe(1);
    const meeting = [...h.video.meetings.values()][0]!;
    expect(meeting.agenda).not.toContain("Zoom Client"); // no client details sent to Zoom
    expect(lastEmail().text).toContain(b!.videoJoinUrl!);
    expect(lastEmail().text).toContain("Passcode: 000000");
    expect([...h.calendar.events.values()][0]).toBeTruthy();
    expect(JSON.stringify(b)).not.toMatch(/start_url|startUrl/);
  });

  it("in-person choice for a hybrid service: no meeting, venue note instead", async () => {
    const r = await book({ serviceId: "personal-alignment-session", startsAt: new Date("2026-01-07T10:00:00Z"), attendanceMode: "in_person" });
    await applyPaymentEvent(h.db, "mock", { kind: "payment_succeeded", providerEventId: "e1", providerRef: "pi_1", reference: r.bookingId, amountMinor: 22200, feeMinor: 0, currency: "GBP" });
    await h.drainAll();
    const [b] = await h.db.select().from(bookings).where(eq(bookings.id, r.bookingId));
    expect(b!.attendanceMode).toBe("in_person");
    expect(h.video.meetings.size).toBe(0);
    expect(lastEmail().subject).toBe("Preparing for your session");
    expect(lastEmail().text).toContain("This session is in person");
  });

  it("if Zoom is down, the confirmation waits and goes out once with the link after a retry", async () => {
    h.video.failNext = 1;
    await book();
    await h.drainAll();
    expect(h.email.outbox.filter((m) => m.subject === "Your discovery call is confirmed")).toHaveLength(0);
    await h.drainAll(new Date(Date.now() + backoffMs(1) + 1000));
    const sent = h.email.outbox.filter((m) => m.subject === "Your discovery call is confirmed");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("mock-zoom");
    expect(h.video.meetings.size).toBe(1);
  });

  it("moves the meeting on reschedule and deletes it on cancellation", async () => {
    const r = await book();
    await h.drainAll();
    const id = [...h.video.meetings.keys()][0]!;
    await rescheduleBooking(h.db, r.bookingId, new Date("2026-01-08T13:00:00Z"), "user:t", MONDAY);
    await h.drainAll();
    expect(h.video.meetings.get(id)!.start.toISOString()).toBe("2026-01-08T13:00:00.000Z");
    expect(lastEmail().subject).toBe("Your session has been rescheduled");
    expect(lastEmail().text).toContain("mock-zoom");
    await cancelBooking(h.db, r.bookingId, "user:t", "client asked");
    await h.drainAll();
    expect(h.video.meetings.get(id)!.deleted).toBe(true);
    const [b] = await h.db.select().from(bookings).where(eq(bookings.id, r.bookingId));
    expect(b!.videoJoinUrl).toBeNull();
  });

  it("reminders include the join link", async () => {
    await book();
    await h.drainAll();
    await sendReminders(h.db, new Date("2026-01-05T10:00:00Z"));
    expect(lastEmail().subject).toMatch(/^Reminder:/);
    expect(lastEmail().text).toContain("mock-zoom");
  });
});

describe("Zoom for online events", () => {
  const base = { title: "Online Breath Circle (test)", location: "Online (Zoom)", startsAt: new Date(Date.now() + 10 * 86400_000), endsAt: new Date(Date.now() + 10 * 86400_000 + 90 * 60_000), capacity: 20, priceMinor: 0, status: "open" as const, isOnline: true };

  it("shares one meeting across registrants and follows edits and cancellation", async () => {
    const id = await createEvent(h.db, base, "user:t");
    await registerForEvent(h.db, { eventId: id, name: "A (test)", email: "a@example.test", acceptedTerms: true });
    await registerForEvent(h.db, { eventId: id, name: "B (test)", email: "b@example.test", acceptedTerms: true });
    await h.drainAll();
    expect(h.video.meetings.size).toBe(1);
    const confirmations = h.email.outbox.filter((m) => m.subject.startsWith("You're registered"));
    expect(confirmations).toHaveLength(2);
    expect(confirmations.every((m) => m.text.includes("mock-zoom"))).toBe(true);

    const newStart = new Date(base.startsAt.getTime() + 3600_000);
    await updateEvent(h.db, id, { startsAt: newStart, endsAt: new Date(newStart.getTime() + 90 * 60_000) }, "user:t");
    const meetingId = [...h.video.meetings.keys()][0]!;
    expect(h.video.meetings.get(meetingId)!.start.toISOString()).toBe(newStart.toISOString());

    await updateEvent(h.db, id, { status: "cancelled" }, "user:t");
    expect(h.video.meetings.get(meetingId)!.deleted).toBe(true);
    const [ev] = await h.db.select().from(programmeEvents).where(eq(programmeEvents.id, id));
    expect(ev!.videoJoinUrl).toBeNull();
  });

  it("in-person events never create a meeting", async () => {
    const id = await createEvent(h.db, { ...base, isOnline: false, location: "Bath (test)" }, "user:t");
    await registerForEvent(h.db, { eventId: id, name: "C (test)", email: "c@example.test", acceptedTerms: true });
    await h.drainAll();
    expect(h.video.meetings.size).toBe(0);
  });
});

describe("Zoom API client", () => {
  it("authenticates with Server-to-Server OAuth, creates a private, unrecorded meeting and keeps only the join link", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).startsWith("https://zoom.us/oauth/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      if (init.method === "POST") return new Response(JSON.stringify({ id: 123456789, join_url: "https://zoom.us/j/123456789?pwd=x", password: "abc123", start_url: "https://zoom.us/s/SECRET" }), { status: 201 });
      if (init.method === "DELETE") return new Response(null, { status: 404 }); // already gone is fine
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const z = new ZoomProvider({ accountId: "acc", clientId: "cid", clientSecret: "sec", hostUser: "felicia@example.test" }, fakeFetch);
    const m = await z.createMeeting({ topic: "Session", start: new Date("2026-01-06T10:00:00Z"), durationMinutes: 20, timezone: "Europe/London", idempotencyKey: "k" });
    expect(m).toEqual({ meetingId: "123456789", joinUrl: "https://zoom.us/j/123456789?pwd=x", passcode: "abc123" });
    expect(JSON.stringify(m)).not.toContain("SECRET");
    expect(calls[0]!.url).toContain("grant_type=account_credentials&account_id=acc");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("cid:sec").toString("base64")}`);
    expect(calls[1]!.url).toBe("https://api.zoom.us/v2/users/felicia%40example.test/meetings");
    const body = JSON.parse(String(calls[1]!.init.body));
    expect(body.settings).toMatchObject({ waiting_room: true, join_before_host: false, auto_recording: "none" });
    expect(body.start_time).toBe("2026-01-06T10:00:00Z");
    await z.updateMeeting("123456789", { start: new Date("2026-01-07T10:00:00Z"), durationMinutes: 20, timezone: "Europe/London" });
    await expect(z.deleteMeeting("123456789")).resolves.toBeUndefined();
    expect(calls.filter((c) => c.url.includes("oauth"))).toHaveLength(1); // token reused
  });

  it("reports Zoom errors as retryable or not", async () => {
    const fail = (status: number) => (async (url: string) => (String(url).includes("oauth") ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 }) : new Response("{}", { status }))) as unknown as typeof fetch;
    const req = { topic: "x", start: new Date(), durationMinutes: 20, timezone: "Europe/London", idempotencyKey: "k" };
    await expect(new ZoomProvider({ accountId: "a", clientId: "b", clientSecret: "c", hostUser: "me" }, fail(429)).createMeeting(req)).rejects.toMatchObject({ retryable: true });
    await expect(new ZoomProvider({ accountId: "a", clientId: "b", clientSecret: "c", hostUser: "me" }, fail(400)).createMeeting(req)).rejects.toMatchObject({ retryable: false });
  });
});

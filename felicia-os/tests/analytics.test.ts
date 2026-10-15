import { describe, it, expect, beforeEach } from "vitest";
import { harness, MONDAY, type Harness } from "./helpers";
import { analyticsCount, channelOf, deviceFrom, funnelReport, ingest, markAttendance, purgeOldAnalytics, sanitisePath, websiteReport } from "@/lib/analytics/analytics";
import { analyticsEvents, bookings, settings } from "@/lib/db/schema";
import { createEnquiry, requestBooking } from "@/lib/booking/booking";
import { applyPaymentEvent } from "@/lib/payments/processing";
import { createEvent, registerForEvent } from "@/lib/programme/events";
import { eq } from "drizzle-orm";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const SITE = "metamastermindz.com";
const UA_PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1";
const UA_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";
const view = (path: string, o: Partial<Parameters<typeof ingest>[1]> = {}) =>
  ingest(h.db, { name: "pageview", url: `https://${SITE}${path}`, userAgent: UA_DESKTOP, ip: "203.0.113.5", siteHost: SITE, now: new Date("2026-01-05T10:00:00Z"), ...o });

describe("privacy", () => {
  it("stores no IP, user agent, query string or email, and skips GPC, bots and private pages", async () => {
    expect(await view("/sessions?email=jane@example.test&utm_source=instagram&utm_medium=social")).toBe("recorded");
    expect(await view("/contact", { gpc: true })).toBe("skipped_gpc");
    expect(await view("/", { userAgent: "Googlebot/2.1" })).toBe("skipped_bot");
    expect(await view("/admin/finance")).toBe("skipped_private");
    expect(await view("/intake")).toBe("skipped_private");
    expect(await ingest(h.db, { name: "pageview", url: "https://evil.example/", userAgent: UA_DESKTOP, ip: "1.1.1.1", siteHost: SITE })).toBe("rejected");
    expect(await view("/", { name: "made_up_event" })).toBe("rejected");
    const rows = await h.db.select().from(analyticsEvents);
    expect(rows).toHaveLength(1);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("203.0.113.5");
    expect(dump).not.toContain("jane");
    expect(dump).not.toContain("Macintosh");
    expect(rows[0]!.path).toBe("/sessions");
    expect(rows[0]!.utmSource).toBe("instagram");
  });

  it("masks ids, tokens and emails in paths", () => {
    expect(sanitisePath("/events/evn_abcdef1234567890abcd")).toBe("/events/:id");
    expect(sanitisePath("/x/jane%40example.test")).toBe("/x/:redacted");
    expect(sanitisePath("/faq?x=1")).toBe("/faq");
  });

  it("rotates the visitor salt daily, so the same person on two days can't be linked", async () => {
    await view("/", { now: new Date("2026-01-05T10:00:00Z") });
    await view("/faq", { now: new Date("2026-01-05T11:00:00Z") });
    const [salt1] = await h.db.select().from(settings).where(eq(settings.key, "analytics_salt"));
    await view("/", { now: new Date("2026-01-06T10:00:00Z") });
    const [salt2] = await h.db.select().from(settings).where(eq(settings.key, "analytics_salt"));
    expect((salt1!.value as { salt: string }).salt).not.toBe((salt2!.value as { salt: string }).salt);
    const rows = await h.db.select().from(analyticsEvents);
    expect(rows[0]!.visitorHash).toBe(rows[1]!.visitorHash);
    expect(rows[2]!.visitorHash).not.toBe(rows[0]!.visitorHash);
  });

  it("deletes raw events after the retention period", async () => {
    await view("/", { now: new Date("2025-01-01T10:00:00Z") });
    await view("/", { now: new Date("2026-01-05T10:00:00Z") });
    expect((await purgeOldAnalytics(h.db, new Date("2026-03-01T00:00:00Z"))).deleted).toBe(1);
    expect(await analyticsCount(h.db)).toBe(1);
  });
});

describe("classification", () => {
  it("devices and channels", () => {
    expect(deviceFrom(UA_PHONE)).toBe("mobile");
    expect(deviceFrom(UA_DESKTOP)).toBe("desktop");
    expect(channelOf({ utmMedium: "social", utmSource: "instagram", referrerHost: null })).toBe("Social");
    expect(channelOf({ utmMedium: null, utmSource: null, referrerHost: "l.instagram.com" })).toBe("Social");
    expect(channelOf({ utmMedium: null, utmSource: null, referrerHost: "google.co.uk" })).toBe("Search");
    expect(channelOf({ utmMedium: "email", utmSource: "newsletter", referrerHost: null })).toBe("Email");
    expect(channelOf({ utmMedium: null, utmSource: null, referrerHost: "wellnesspartner.example" })).toBe("Referral");
    expect(channelOf({ utmMedium: null, utmSource: null, referrerHost: null })).toBe("Direct");
  });
});

describe("reports", () => {
  it("counts visits, pages, sources and daily series for a range", async () => {
    const day1 = new Date("2026-01-05T10:00:00Z");
    await view("/?utm_source=instagram&utm_medium=social", { now: day1, ip: "a" });
    await view("/sessions", { now: day1, ip: "a" });
    await view("/book", { now: day1, ip: "a" });
    await view("/", { now: day1, ip: "b", referrer: "https://www.google.com/" });
    await view("/", { now: new Date("2026-01-06T09:00:00Z"), ip: "a", userAgent: UA_PHONE });
    await ingest(h.db, { name: "cta_click", label: "cta_hero_discovery", url: `https://${SITE}/`, userAgent: UA_DESKTOP, ip: "a", siteHost: SITE, now: day1 });
    const r = await websiteReport(h.db, { from: "2026-01-05", to: "2026-01-07" });
    expect(r.visits).toBe(3);
    expect(r.pageviews).toBe(5);
    expect(r.daily.map((d) => d.visits)).toEqual([2, 1, 0]);
    expect(r.channels).toEqual(expect.arrayContaining([{ channel: "Social", visits: 1 }, { channel: "Search", visits: 1 }, { channel: "Direct", visits: 1 }]));
    expect(r.topPages[0]).toMatchObject({ path: "/", views: 3 });
    expect(r.visitsViewingBooking).toBe(1);
    expect(r.ctaClicks).toEqual([{ label: "cta_hero_discovery", clicks: 1 }]);
    expect(r.devices).toEqual(expect.arrayContaining([{ device: "mobile", visits: 1 }]));
  });

  it("funnels count conversions from business records and follow people for B", async () => {
    // Today-relative so record timestamps (created now) fall inside the range.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
    const range = { from: today, to: today };
    const ev = await createEvent(h.db, { title: "Workshop (test)", location: "Online", startsAt: new Date(Date.now() + 7 * 86400_000), endsAt: new Date(Date.now() + 7 * 86400_000 + 3 * 3600_000), capacity: 10, priceMinor: 0, status: "open" }, "user:t");
    await registerForEvent(h.db, { eventId: ev, name: "Funnel Person (test)", email: "fp@example.test", acceptedTerms: true });
    await createEnquiry(h.db, { name: "Partner Lead (test)", email: "pl@example.test", message: "Referred by a partner", source: "partner_referral" }, "p1");
    const disc = await requestBooking(h.db, { serviceId: "discovery-call", startsAt: new Date("2026-01-06T10:00:00Z"), name: "Funnel Person (test)", email: "fp@example.test", clientTimezone: "Europe/London", acceptedTerms: true }, "d1", MONDAY);
    const paid = await requestBooking(h.db, { serviceId: "signature-private-session", startsAt: new Date("2026-01-07T10:00:00Z"), name: "Payer (test)", email: "payer@example.test", clientTimezone: "Europe/London", acceptedTerms: true }, "s1", MONDAY);
    await applyPaymentEvent(h.db, "mock", { kind: "payment_succeeded", providerEventId: "e1", providerRef: "pi_1", reference: paid.bookingId, amountMinor: 33300, feeMinor: 0, currency: "GBP" });
    await h.drainAll();

    const f = await funnelReport(h.db, range);
    const step = (key: string, i: number) => f.funnels.find((x) => x.key === key)!.steps[i]!.value;
    expect(step("A", 1)).toBe(1); // discovery calls
    expect(step("A", 2)).toBe(1); // paid private sessions
    expect(step("B", 0)).toBe(1); // workshop registrant
    expect(step("B", 1)).toBe(1); // same person booked a discovery call
    expect(step("C", 0)).toBe(1); // partner-referred person
    expect(step("D", 1)).toBe(1);
    expect(f.revenueMinor).toBe(33300);
    expect(f.website.at(-1)!.value).toBe(1);

    // Attendance drives show-up rate.
    await markAttendance(h.db, "booking", disc.bookingId, false);
    const [b] = await h.db.select().from(bookings).where(eq(bookings.id, disc.bookingId));
    expect(b!.status).toBe("no_show");
  });
});

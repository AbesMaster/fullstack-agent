import { createHash, randomBytes } from "node:crypto";
import { and, between, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { analyticsEvents, bookings, contacts, enquiries, eventRegistrations, payments } from "../db/schema";
import { getSetting, setSetting } from "../settings";
import { newId } from "../util";

/**
 * First-party, cookieless analytics.
 *
 * Privacy design (UK GDPR / PECR):
 * - Nothing is stored on the visitor's device, so no cookie banner is required.
 * - No IP address, user agent string, query string or personal data is stored.
 * - A visitor is counted once per day using sha256(dailySalt + ip + userAgent). The
 *   salt is random and replaced every day (the old one is overwritten), so the hash
 *   can't be reversed, linked across days, or tied to a person.
 * - Browsers sending Global Privacy Control (Sec-GPC: 1) are not counted at all.
 * - Private pages (admin, sign-in, client forms) are never recorded.
 * - Raw events are deleted after 13 months; aggregate reports remain possible meanwhile.
 *
 * Bookings, enquiries, registrations and payments are counted from the business records,
 * not from browser events, so conversion figures are exact even when people block scripts.
 */

export const EVENT_NAMES = ["pageview", "cta_click", "enquiry_submitted", "booking_requested", "booking_confirmed", "event_registration", "chat_opened"] as const;
export type AnalyticsEventName = (typeof EVENT_NAMES)[number];

export const RETENTION_DAYS = 395;

const PRIVATE_PREFIXES = ["/admin", "/login", "/intake", "/feedback", "/unsubscribe", "/api", "/book/mock-checkout"];
const BOT = /bot|crawl|spider|slurp|bingpreview|headless|lighthouse|pagespeed|facebookexternalhit|embedly|monitor|curl|wget|python-requests|axios|node-fetch|go-http-client/i;
const SOCIAL_HOSTS = /(^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.me|tiktok\.com|youtube\.com|youtu\.be|t\.co|x\.com|twitter\.com|linkedin\.com|lnkd\.in|pinterest\.[a-z.]+|threads\.net)$/i;
const SEARCH_HOSTS = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.[a-z.]+|ecosia\.org|search\.brave\.com)$/i;

const ukDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

async function dailySalt(db: DB, now: Date) {
  const day = ukDay(now);
  const cur = await getSetting<{ day: string; salt: string } | null>(db, "analytics_salt", null);
  if (cur?.day === day) return cur.salt;
  const salt = randomBytes(32).toString("base64");
  await setSetting(db, "analytics_salt", { day, salt }, "system"); // overwrites (discards) yesterday's salt
  return salt;
}

const clean = (v: string | null | undefined, max = 60) => {
  const s = (v ?? "").toLowerCase().trim().replace(/[^a-z0-9_.\-]/g, "").slice(0, max);
  return s || null;
};

export function deviceFrom(ua: string): "mobile" | "tablet" | "desktop" {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|android/i.test(ua)) return "mobile";
  return "desktop";
}

/** Keeps the path only; drops query strings and masks anything that looks like an id, token or email. */
export function sanitisePath(pathname: string) {
  const p = pathname.split(/[?#]/)[0] ?? "/";
  return (
    p
      .split("/")
      .map((seg) => (/@|%40/.test(seg) ? ":redacted" : /^[a-z]{2,4}_[a-z0-9]{12,}$/i.test(seg) || /^[A-Za-z0-9_-]{24,}$/.test(seg) ? ":id" : seg))
      .join("/")
      .slice(0, 200) || "/"
  );
}

export type IngestInput = {
  name: string;
  url: string; // full page URL, as seen by the browser
  label?: string | null;
  referrer?: string | null;
  userAgent: string;
  ip: string;
  gpc?: boolean;
  siteHost: string;
  now?: Date;
};

export type IngestResult = "recorded" | "skipped_gpc" | "skipped_bot" | "skipped_private" | "rejected";

export async function ingest(db: DB, input: IngestInput): Promise<IngestResult> {
  if (input.gpc) return "skipped_gpc";
  if (!input.userAgent || BOT.test(input.userAgent)) return "skipped_bot";
  if (!(EVENT_NAMES as readonly string[]).includes(input.name)) return "rejected";
  let page: URL;
  try {
    page = new URL(input.url);
  } catch {
    return "rejected";
  }
  if (page.host !== input.siteHost) return "rejected"; // only our own pages
  if (PRIVATE_PREFIXES.some((p) => page.pathname === p || page.pathname.startsWith(`${p}/`))) return "skipped_private";

  let referrerHost: string | null = null;
  if (input.referrer) {
    try {
      const r = new URL(input.referrer);
      if (r.host !== input.siteHost) referrerHost = r.hostname.replace(/^www\./, "").slice(0, 100);
    } catch {
      /* ignore malformed referrers */
    }
  }
  const now = input.now ?? new Date();
  const salt = await dailySalt(db, now);
  const visitorHash = createHash("sha256").update(`${salt}|${input.ip}|${input.userAgent}`).digest("base64url").slice(0, 22);
  const label = input.label ? input.label.replace(/[^a-z0-9_:\-]/gi, "").slice(0, 80) || null : null;

  await db.insert(analyticsEvents).values({
    id: newId("ana"),
    day: ukDay(now),
    at: now,
    name: input.name,
    path: sanitisePath(page.pathname),
    label,
    referrerHost,
    utmSource: clean(page.searchParams.get("utm_source")),
    utmMedium: clean(page.searchParams.get("utm_medium")),
    utmCampaign: clean(page.searchParams.get("utm_campaign"), 80),
    device: deviceFrom(input.userAgent),
    visitorHash,
  });
  return "recorded";
}

export async function purgeOldAnalytics(db: DB, now = new Date()) {
  const cutoff = ukDay(new Date(now.getTime() - RETENTION_DAYS * 86400_000));
  const deleted = await db.delete(analyticsEvents).where(lt(analyticsEvents.day, cutoff)).returning({ id: analyticsEvents.id });
  return { deleted: deleted.length };
}

/* ------------------------------------------------------------------ */
/* Reports                                                            */
/* ------------------------------------------------------------------ */

export type Channel = "Direct" | "Search" | "Social" | "Email" | "Referral" | "Campaign";

export function channelOf(e: { utmMedium: string | null; utmSource: string | null; referrerHost: string | null }): Channel {
  const m = e.utmMedium ?? "";
  if (/social/.test(m) || (e.utmSource && SOCIAL_HOSTS.test(`${e.utmSource}.com`))) return "Social";
  if (/email|newsletter/.test(m)) return "Email";
  if (m || e.utmSource) return "Campaign";
  if (!e.referrerHost) return "Direct";
  if (SOCIAL_HOSTS.test(e.referrerHost)) return "Social";
  if (SEARCH_HOSTS.test(e.referrerHost)) return "Search";
  return "Referral";
}

export type Range = { from: string; to: string }; // inclusive UK days, YYYY-MM-DD

export function rangeEndingToday(days: number, now = new Date()): Range {
  return { from: ukDay(new Date(now.getTime() - (days - 1) * 86400_000)), to: ukDay(now) };
}

/** UTC instants covering the UK-day range (for querying business records by timestamp). */
function instants(r: Range) {
  const start = new Date(`${r.from}T00:00:00Z`);
  const end = new Date(new Date(`${r.to}T00:00:00Z`).getTime() + 86400_000);
  // Widen by an hour each side for BST; records are then filtered by UK day exactly.
  return { start: new Date(start.getTime() - 3600_000), end: new Date(end.getTime() + 3600_000) };
}
const inRange = (d: Date, r: Range) => {
  const k = ukDay(d);
  return k >= r.from && k <= r.to;
};

const PRIVATE_SESSION_IDS = ["personal-alignment-session", "signature-private-session", "premium-private-experience", "couples-experience"];
const PROGRAMME_IDS = ["four-session-journey", "eight-week-programme"];

export async function websiteReport(db: DB, r: Range) {
  const rows = await db.select().from(analyticsEvents).where(between(analyticsEvents.day, r.from, r.to));
  const views = rows.filter((e) => e.name === "pageview");

  // Visits = distinct visitor-days (a person visiting on 3 days counts 3 times; we deliberately can't link days).
  const dayKey = (e: (typeof rows)[number]) => `${e.day}|${e.visitorHash}`;
  const daily = new Map<string, { visits: Set<string>; pageviews: number }>();
  for (let d = new Date(`${r.from}T12:00:00Z`); ukDay(d) <= r.to; d = new Date(d.getTime() + 86400_000)) daily.set(ukDay(d), { visits: new Set(), pageviews: 0 });
  for (const e of views) {
    const b = daily.get(e.day as string);
    if (!b) continue;
    b.visits.add(e.visitorHash);
    b.pageviews++;
  }

  const firstViewPerVisit = new Map<string, (typeof rows)[number]>();
  for (const e of [...views].sort((a, b) => a.at.getTime() - b.at.getTime())) if (!firstViewPerVisit.has(dayKey(e))) firstViewPerVisit.set(dayKey(e), e);

  const count = <K extends string>(items: K[]) => {
    const m = new Map<K, number>();
    for (const k of items) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const visitsTotal = firstViewPerVisit.size;
  const pages = new Map<string, { views: number; visits: Set<string> }>();
  for (const e of views) {
    const p = pages.get(e.path) ?? { views: 0, visits: new Set() };
    p.views++;
    p.visits.add(dayKey(e));
    pages.set(e.path, p);
  }
  const landing = [...firstViewPerVisit.values()];
  const visitsWith = (pred: (path: string) => boolean) => new Set(views.filter((e) => pred(e.path)).map(dayKey)).size;

  return {
    kind: "website" as const,
    range: r,
    visits: visitsTotal,
    pageviews: views.length,
    pagesPerVisit: visitsTotal ? Math.round((views.length / visitsTotal) * 10) / 10 : null,
    daily: [...daily.entries()].map(([day, v]) => ({ day, visits: v.visits.size, pageviews: v.pageviews })),
    topPages: [...pages.entries()].map(([path, v]) => ({ path, views: v.views, visits: v.visits.size })).sort((a, b) => b.views - a.views).slice(0, 12),
    channels: count(landing.map(channelOf)).map(([channel, visits]) => ({ channel, visits })),
    sources: count(landing.map((e) => e.utmSource ?? e.referrerHost ?? "(direct)")).slice(0, 10).map(([source, visits]) => ({ source, visits })),
    campaigns: count(landing.filter((e) => e.utmCampaign).map((e) => e.utmCampaign!)).slice(0, 10).map(([campaign, visits]) => ({ campaign, visits })),
    devices: count(landing.map((e) => e.device)).map(([device, visits]) => ({ device, visits })),
    ctaClicks: count(rows.filter((e) => e.name === "cta_click" && e.label).map((e) => e.label!)).slice(0, 12).map(([label, clicks]) => ({ label, clicks })),
    chatOpens: rows.filter((e) => e.name === "chat_opened").length,
    visitsViewingBooking: visitsWith((p) => p === "/book"),
    visitsViewingEvents: visitsWith((p) => p.startsWith("/events/")),
    socialVisits: landing.filter((e) => channelOf(e) === "Social").length,
  };
}

/** Business-record funnels (exact, from the database) for the same range. */
export async function funnelReport(db: DB, r: Range, site?: Awaited<ReturnType<typeof websiteReport>>) {
  const { start, end } = instants(r);
  const web = site ?? (await websiteReport(db, r));
  const bks = (await db.select().from(bookings).where(and(gte(bookings.createdAt, start), lt(bookings.createdAt, end)))).filter((b) => inRange(b.createdAt, r));
  const allBookings = await db.select().from(bookings);
  const pays = await db.select().from(payments);
  const paidBookingIds = new Set(pays.filter((p) => p.bookingId && (p.status === "succeeded" || p.status === "partially_refunded")).map((p) => p.bookingId!));
  const enq = (await db.select().from(enquiries).where(and(gte(enquiries.createdAt, start), lt(enquiries.createdAt, end)))).filter((e) => inRange(e.createdAt, r));
  const regs = (await db.select().from(eventRegistrations).where(and(gte(eventRegistrations.createdAt, start), lt(eventRegistrations.createdAt, end)))).filter((x) => inRange(x.createdAt, r));
  const allRegs = await db.select().from(eventRegistrations);
  const partnerContacts = new Set((await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.source, "partner_referral"))).map((c) => c.id));
  for (const e of await db.select().from(enquiries).where(eq(enquiries.channel, "partner_referral"))) partnerContacts.add(e.contactId);

  const discovery = bks.filter((b) => b.serviceId === "discovery-call" && b.status !== "cancelled");
  const paidIn = (ids: string[] | null, pool = bks) => pool.filter((b) => paidBookingIds.has(b.id) && (!ids || ids.includes(b.serviceId)));

  // Website funnel: visits → looked at booking → asked (enquiry or booking) → paid.
  const website = [
    { stage: "Website visits", value: web.visits, source: "site" as const },
    { stage: "Viewed the booking page", value: web.visitsViewingBooking, source: "site" as const },
    { stage: "Enquiries + bookings made", value: enq.length + bks.filter((b) => b.status !== "cancelled" || paidBookingIds.has(b.id)).length, source: "records" as const },
    { stage: "Paid bookings", value: paidIn(null).length, source: "records" as const },
  ];

  // A: social → discovery call → private booking (period totals; visits can't be tied to people).
  const funnelA = [
    { stage: "Visits from social media", value: web.socialVisits, source: "site" as const },
    { stage: "Discovery calls booked", value: discovery.length, source: "records" as const },
    { stage: "Paid private sessions", value: paidIn(PRIVATE_SESSION_IDS).length, source: "records" as const },
  ];

  // B: workshop attendee → consultation → programme (same people, followed through records).
  const workshopPeople = new Set(regs.filter((x) => x.status === "confirmed" || x.status === "attended").map((x) => x.contactId));
  const consultedB = new Set(allBookings.filter((b) => b.serviceId === "discovery-call" && workshopPeople.has(b.contactId) && b.status !== "cancelled").map((b) => b.contactId));
  const programmeB = new Set(paidIn(PROGRAMME_IDS, allBookings).filter((b) => workshopPeople.has(b.contactId)).map((b) => b.contactId));
  const funnelB = [
    { stage: "Workshop / event registrants", value: workshopPeople.size, source: "records" as const },
    { stage: "Then booked a discovery call", value: consultedB.size, source: "records" as const },
    { stage: "Then bought a programme", value: programmeB.size, source: "records" as const },
  ];

  // C: partner referral → consultation → any paid service.
  const referredInRange = new Set([...enq.filter((e) => partnerContacts.has(e.contactId)).map((e) => e.contactId), ...bks.filter((b) => partnerContacts.has(b.contactId)).map((b) => b.contactId)]);
  const consultedC = new Set(allBookings.filter((b) => b.serviceId === "discovery-call" && referredInRange.has(b.contactId) && b.status !== "cancelled").map((b) => b.contactId));
  const paidC = new Set(paidIn(null, allBookings).filter((b) => b.serviceId !== "discovery-call" && referredInRange.has(b.contactId)).map((b) => b.contactId));
  const funnelC = [
    { stage: "Partner-referred people", value: referredInRange.size, source: "records" as const },
    { stage: "Booked a discovery call", value: consultedC.size, source: "records" as const },
    { stage: "Bought a service", value: paidC.size, source: "records" as const },
  ];

  // D: event page → registration → attendance (attendance from past events in range).
  const registeredD = regs.filter((x) => x.status === "confirmed" || x.status === "attended" || x.status === "no_show").length;
  const attendanceKnown = allRegs.filter((x) => inRange(x.createdAt, r) && (x.status === "attended" || x.status === "no_show"));
  const funnelD = [
    { stage: "Visits viewing an event page", value: web.visitsViewingEvents, source: "site" as const },
    { stage: "Registered", value: registeredD, source: "records" as const },
    { stage: "Attended (marked)", value: attendanceKnown.filter((x) => x.status === "attended").length, source: "records" as const },
  ];

  // Show-up: sessions in range marked completed vs no-show.
  const sessionsHeld = allBookings.filter((b) => inRange(b.startsAt, r) && (b.status === "completed" || b.status === "no_show"));
  const showUpRatePct = sessionsHeld.length ? Math.round((sessionsHeld.filter((b) => b.status === "completed").length / sessionsHeld.length) * 1000) / 10 : null;
  const eventShowUpPct = attendanceKnown.length ? Math.round((attendanceKnown.filter((x) => x.status === "attended").length / attendanceKnown.length) * 1000) / 10 : null;

  const paidInRange = pays.filter((p) => p.paidAt && inRange(p.paidAt, r) && p.status !== "failed" && p.status !== "pending");
  const revenueMinor = paidInRange.reduce((s, p) => s + p.amountMinor, 0);
  const refundsMinor = paidInRange.reduce((s, p) => s + p.refundedMinor, 0);

  return {
    kind: "records" as const,
    website,
    funnels: [
      { key: "A", title: "Social content → discovery call → private session", note: "Period totals. Website visits can't be linked to individual people, so this shows volume at each step, not the same people moving through.", steps: funnelA },
      { key: "B", title: "Workshop → consultation → programme", note: "Follows the same people through your records.", steps: funnelB },
      { key: "C", title: "Partner referral → consultation → service", note: "Follows the same people through your records. Mark referrals by choosing 'partner referral' as the source.", steps: funnelC },
      { key: "D", title: "Event page → registration → attendance", note: "Attendance counts only places you've marked attended or no-show.", steps: funnelD },
    ],
    showUpRatePct,
    eventShowUpPct,
    revenueMinor,
    refundRatePct: revenueMinor ? Math.round((refundsMinor / revenueMinor) * 1000) / 10 : null,
    conversionPct: web.visits ? Math.round((paidIn(null).length / web.visits) * 1000) / 10 : null,
  };
}

/** Owner/staff record whether someone came. Drives show-up rates. */
export async function markAttendance(db: DB, kind: "booking" | "registration", id: string, attended: boolean) {
  if (kind === "booking") {
    const [b] = await db.update(bookings).set({ status: attended ? "completed" : "no_show" }).where(and(eq(bookings.id, id), inArray(bookings.status, ["confirmed", "completed", "no_show"]))).returning();
    if (!b) throw new Error("Booking not found or not confirmed");
    return b.status;
  }
  const [r] = await db.update(eventRegistrations).set({ status: attended ? "attended" : "no_show" }).where(and(eq(eventRegistrations.id, id), inArray(eventRegistrations.status, ["confirmed", "attended", "no_show"]))).returning();
  if (!r) throw new Error("Registration not found or not confirmed");
  return r.status;
}

export const analyticsCount = async (db: DB) => (await db.select({ n: sql<number>`count(*)::int` }).from(analyticsEvents))[0]?.n ?? 0;

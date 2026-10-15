import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, gt, gte, inArray, isNull } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import type { DB } from "../db/client";
import { agentTasks, bookings, clientLoginTokens, contacts, emailSuppressions, enquiries, eventRegistrations, intakeRecords, payments, programmeEvents, services } from "../db/schema";
import { sendTemplate } from "../email/send";
import { sessionKey } from "../auth/auth";
import { audit } from "../audit/audit";
import { env } from "../config/env";
import { newId, normaliseEmail } from "../util";
import { signResourceToken } from "../security/tokens";

/**
 * Client portal: passwordless sign-in by emailed link.
 *
 * - Clients never create a password. They type their email and receive a single-use link.
 * - Only a SHA-256 hash of each link token is stored; tokens expire after 15 minutes.
 * - The response to "send me a link" is identical whether or not the email is known,
 *   so the form can't be used to discover who is a client.
 * - The link opens a page with a "Sign in" button rather than signing in on GET, so email
 *   security scanners that pre-open links can't use up the token.
 * - Client sessions carry aud="client" and can never open the Command Center (and vice versa).
 * - The portal shows only the signed-in client's own records, and never their intake answers.
 */

export const CLIENT_COOKIE = "fos_client";
export const LINK_TTL_MINUTES = 15;
export const SESSION_DAYS = 7;
const MAX_LINKS_PER_EMAIL_PER_15_MIN = 3;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/* ---------------- Requesting and using a link ---------------- */

export async function requestSignInLink(db: DB, email: string, now = new Date()): Promise<"sent" | "not_found" | "throttled"> {
  const address = normaliseEmail(z.string().email().max(254).parse(email));
  const [c] = await db.select().from(contacts).where(eq(contacts.email, address));
  if (!c) return "not_found";
  // Only people who have actually booked or registered get an account area.
  const [hasBooking] = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.contactId, c.id)).limit(1);
  const [hasReg] = await db.select({ id: eventRegistrations.id }).from(eventRegistrations).where(eq(eventRegistrations.contactId, c.id)).limit(1);
  if (!hasBooking && !hasReg) return "not_found";

  const recent = await db.select({ id: clientLoginTokens.id }).from(clientLoginTokens).where(and(eq(clientLoginTokens.contactId, c.id), gte(clientLoginTokens.createdAt, new Date(now.getTime() - 15 * 60_000))));
  if (recent.length >= MAX_LINKS_PER_EMAIL_PER_15_MIN) return "throttled";

  const token = randomBytes(32).toString("base64url");
  await db.insert(clientLoginTokens).values({ id: newId("clt"), contactId: c.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + LINK_TTL_MINUTES * 60_000), createdAt: now });
  await sendTemplate(db, "portal_sign_in", c.email, { name: c.name.split(" ")[0] ?? c.name, link: `${env().APP_URL}/portal/sign-in?t=${token}` });
  await audit(db, { actor: `client:${c.id}`, action: "portal.link_requested" });
  return "sent";
}

/** Uses a link token once. Returns the contact id, or null if invalid, used or expired. */
export async function consumeSignInLink(db: DB, token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await db
    .update(clientLoginTokens)
    .set({ usedAt: now })
    .where(and(eq(clientLoginTokens.tokenHash, hashToken(token)), isNull(clientLoginTokens.usedAt), gt(clientLoginTokens.expiresAt, now)))
    .returning();
  if (!row) return null;
  await audit(db, { actor: `client:${row.contactId}`, action: "portal.signed_in" });
  return row.contactId;
}

/* ---------------- Client session ---------------- */

export async function createClientSession(contactId: string) {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(contactId).setAudience("client").setIssuedAt().setExpirationTime(`${SESSION_DAYS}d`).sign(sessionKey());
}

export async function readClientSession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey(), { algorithms: ["HS256"], audience: "client" });
    return payload.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

/* ---------------- What the client sees ---------------- */

export async function portalOverview(db: DB, contactId: string, now = new Date()) {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c) return null;
  const rows = await db.select({ b: bookings, s: services }).from(bookings).innerJoin(services, eq(bookings.serviceId, services.id)).where(eq(bookings.contactId, contactId)).orderBy(desc(bookings.startsAt));
  const intakes = new Set((await db.select({ bookingId: intakeRecords.bookingId }).from(intakeRecords).where(inArray(intakeRecords.bookingId, rows.length ? rows.map((r) => r.b.id) : ["-"]))).map((r) => r.bookingId));
  const regs = await db.select({ r: eventRegistrations, e: programmeEvents }).from(eventRegistrations).innerJoin(programmeEvents, eq(eventRegistrations.eventId, programmeEvents.id)).where(eq(eventRegistrations.contactId, contactId)).orderBy(desc(programmeEvents.startsAt));
  const bookingIds = rows.map((r) => r.b.id);
  const regIds = regs.map((r) => r.r.id);
  const pays = (await db.select().from(payments)).filter((p) => (p.bookingId && bookingIds.includes(p.bookingId)) || (p.registrationId && regIds.includes(p.registrationId)));
  const [suppressed] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, c.email));

  const sessions = rows
    .filter(({ b }) => b.status !== "pending_payment")
    .map(({ b, s }) => {
      const upcoming = b.startsAt > now && b.status === "confirmed";
      return {
        id: b.id,
        service: s.name,
        startsAt: b.startsAt,
        timezone: b.clientTimezone,
        status: b.status,
        upcoming,
        attendanceMode: b.attendanceMode,
        // The join link only matters before the session.
        joinUrl: upcoming ? b.videoJoinUrl : null,
        passcode: upcoming ? b.videoPasscode : null,
        welcomeFormDone: intakes.has(b.id),
        welcomeFormUrl: upcoming && s.id !== "discovery-call" && !intakes.has(b.id) ? `/intake?b=${b.id}&t=${signResourceToken("intake", b.id)}` : null,
      };
    });

  const events = regs
    .filter(({ r }) => r.status !== "pending_payment")
    .map(({ r, e }) => {
      const upcoming = e.startsAt > now && r.status === "confirmed" && e.status !== "cancelled";
      return { id: r.id, eventId: e.id, title: e.title, startsAt: e.startsAt, location: e.location, status: e.status === "cancelled" ? "event cancelled" : r.status, upcoming, joinUrl: upcoming && e.isOnline ? e.videoJoinUrl : null, passcode: upcoming && e.isOnline ? e.videoPasscode : null };
    });

  return {
    name: c.name,
    email: c.email,
    marketingConsent: c.marketingConsent && !suppressed,
    upcoming: [...sessions.filter((s) => s.upcoming)].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    past: sessions.filter((s) => !s.upcoming),
    events,
    payments: pays
      .filter((p) => p.status !== "pending" && p.status !== "failed")
      .map((p) => ({ id: p.id, amountMinor: p.amountMinor, refundedMinor: p.refundedMinor, currency: p.currency, paidAt: p.paidAt, status: p.status, for: rows.find((r) => r.b.id === p.bookingId)?.s.name ?? regs.find((r) => r.r.id === p.registrationId)?.e.title ?? "Payment" }))
      .sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0)),
  };
}

/* ---------------- Actions ---------------- */

export const ChangeRequestSchema = z.object({
  bookingId: z.string().min(1).max(80),
  kind: z.enum(["reschedule", "cancel"]),
  message: z.string().trim().max(1000).default(""),
});

/**
 * Clients ask; Felicia decides. Changes go to her as a request (not an automatic
 * cancellation) because the cancellation policy and any refund need a person's judgement.
 */
export async function requestChange(db: DB, contactId: string, input: z.input<typeof ChangeRequestSchema>) {
  const r = ChangeRequestSchema.parse(input);
  const [row] = await db.select({ b: bookings, s: services }).from(bookings).innerJoin(services, eq(bookings.serviceId, services.id)).where(and(eq(bookings.id, r.bookingId), eq(bookings.contactId, contactId)));
  if (!row || row.b.status !== "confirmed") throw new PortalError("That booking can't be changed online. Please contact us.");
  const when = row.b.startsAt.toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "full", timeStyle: "short" });
  const text = `${r.kind === "cancel" ? "Cancellation" : "Reschedule"} request from the client portal for ${row.s.name} on ${when} (booking ${row.b.id}).${r.message ? `\n\nClient's note: ${r.message}` : ""}`;
  const enquiryId = newId("enq");
  await db.insert(enquiries).values({ id: enquiryId, contactId, message: text, interestServiceId: row.s.id, channel: "portal", status: "escalated", escalationReason: `client ${r.kind} request` });
  await db.insert(agentTasks).values({ id: newId("tsk"), agentId: "scheduling", kind: "owner_attention", status: "blocked", input: { summary: `Client asked to ${r.kind === "cancel" ? "cancel" : "reschedule"} ${row.s.name} on ${when}.`, bookingId: row.b.id, enquiryId } });
  await audit(db, { actor: `client:${contactId}`, action: `portal.${r.kind}_requested`, target: row.b.id });
  return { enquiryId };
}

/** Opt in or out of marketing emails. Booking emails are unaffected. */
export async function setMarketingPreference(db: DB, contactId: string, optIn: boolean) {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c) throw new PortalError("Account not found");
  if (optIn) {
    await db.delete(emailSuppressions).where(and(eq(emailSuppressions.email, c.email), eq(emailSuppressions.reason, "unsubscribed")));
    await db.update(contacts).set({ marketingConsent: true, marketingConsentAt: new Date(), marketingConsentSource: "client_portal", updatedAt: new Date() }).where(eq(contacts.id, c.id));
  } else {
    await db.insert(emailSuppressions).values({ email: c.email, reason: "unsubscribed" }).onConflictDoNothing();
    await db.update(contacts).set({ marketingConsent: false, updatedAt: new Date() }).where(eq(contacts.id, c.id));
  }
  await audit(db, { actor: `client:${contactId}`, action: optIn ? "portal.marketing_opt_in" : "portal.marketing_opt_out" });
}

export class PortalError extends Error {}

import { z } from "zod";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import type { DB } from "../db/client";
import { bookings, contacts, enquiries, intakeRecords } from "../db/schema";
import { getService, type Service } from "../services/catalogue";
import { calendarProvider } from "../calendar/provider";
import { paymentProvider } from "../payments/provider";
import { publish } from "../events/bus";
import { audit } from "../audit/audit";
import { env } from "../config/env";
import { newId, normaliseEmail } from "../util";
import { encryptJson } from "../security/encryption";
import { isValidTimeZone, overlaps, wallClock, zonedTimeToUtc } from "./time";

const ACTIVE_STATUSES = ["pending_payment", "confirmed"] as const;
/** Unpaid holds expire so abandoned checkouts don't block the calendar forever. */
export const PENDING_HOLD_MINUTES = 30;

/* ------------------------------------------------------------------ */
/* Contacts & enquiries                                               */
/* ------------------------------------------------------------------ */

export const EnquirySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(40).optional(),
  message: z.string().trim().min(1).max(5000),
  interestServiceId: z.string().max(80).optional(),
  marketingConsent: z.boolean().default(false),
  source: z.enum(["website_form", "chat", "partner_referral", "event", "social", "manual"]).default("website_form"),
  sourceDetail: z.string().max(200).optional(),
  timezone: z.string().max(64).optional(),
});

export async function upsertContact(
  db: DB,
  c: { name: string; email: string; phone?: string; source: string; sourceDetail?: string; timezone?: string; marketingConsent?: boolean; consentSource?: string },
) {
  const email = normaliseEmail(c.email);
  const [existing] = await db.select().from(contacts).where(eq(contacts.email, email));
  if (existing) {
    // Consent is only ever ADDED by an explicit opt-in; it is never silently removed or assumed.
    const grant = c.marketingConsent && !existing.marketingConsent;
    await db
      .update(contacts)
      .set({
        name: c.name || existing.name,
        phone: c.phone ?? existing.phone,
        timezone: c.timezone ?? existing.timezone,
        ...(grant ? { marketingConsent: true, marketingConsentAt: new Date(), marketingConsentSource: c.consentSource ?? c.source } : {}),
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, existing.id));
    return { id: existing.id, created: false };
  }
  const id = newId("con");
  await db.insert(contacts).values({
    id,
    email,
    name: c.name,
    phone: c.phone,
    source: c.source,
    sourceDetail: c.sourceDetail,
    timezone: c.timezone,
    marketingConsent: !!c.marketingConsent,
    marketingConsentAt: c.marketingConsent ? new Date() : null,
    marketingConsentSource: c.marketingConsent ? (c.consentSource ?? c.source) : null,
  });
  return { id, created: true };
}

export async function createEnquiry(db: DB, input: z.input<typeof EnquirySchema>, idempotencyKey: string) {
  const e = EnquirySchema.parse(input);
  if (e.interestServiceId && !(await getService(db, e.interestServiceId))) throw new Error("Unknown service");
  const contact = await upsertContact(db, { ...e, consentSource: "enquiry_form_checkbox" });
  const enquiryId = newId("enq");
  await db.insert(enquiries).values({ id: enquiryId, contactId: contact.id, message: e.message, interestServiceId: e.interestServiceId, channel: e.source });
  const correlationId = newId("cor");
  await publish(db, "LEAD_CREATED", { enquiryId, contactId: contact.id }, { correlationId, idempotencyKey });
  await audit(db, { actor: "public:web", action: "enquiry.created", target: enquiryId, correlationId });
  return { enquiryId, contactId: contact.id, correlationId };
}

/* ------------------------------------------------------------------ */
/* Availability                                                       */
/* ------------------------------------------------------------------ */

export type Slot = { start: Date; end: Date };

export async function busyIntervals(db: DB, from: Date, to: Date, now = new Date(), excludeBookingId?: string) {
  const rows = await db
    .select()
    .from(bookings)
    .where(and(inArray(bookings.status, [...ACTIVE_STATUSES]), lt(bookings.startsAt, to), gt(bookings.endsAt, from)));
  const internal = rows
    .filter((b) => b.id !== excludeBookingId)
    .filter((b) => b.status === "confirmed" || now.getTime() - b.createdAt.getTime() < PENDING_HOLD_MINUTES * 60_000)
    .map((b) => ({ start: b.startsAt, end: b.endsAt }));
  const self = excludeBookingId ? rows.find((b) => b.id === excludeBookingId) : undefined;
  // The booking's own calendar event shows up as external busy time; don't let it block its own reschedule.
  const external = (await calendarProvider().busy(from, to)).filter(
    (x) => !self || x.start.getTime() !== self.startsAt.getTime() || x.end.getTime() !== self.endsAt.getTime(),
  );
  return [...internal, ...external];
}

/** Bookable start times for a service over the next `days` days, honouring notice, buffers and conflicts. */
export async function availableSlots(
  db: DB,
  service: Service,
  opts: { now?: Date; days?: number; stepMinutes?: number; excludeBookingId?: string } = {},
): Promise<Slot[]> {
  const now = opts.now ?? new Date();
  const days = Math.min(opts.days ?? 14, service.bookingRules.maxAdvanceDays);
  const duration = service.durationMinutes ?? 60;
  const step = opts.stepMinutes ?? 30;
  const buffer = service.bookingRules.bufferMinutes * 60_000;
  const { timezone: tz, days: weekdays, startHour, endHour } = service.availability;
  const earliest = new Date(now.getTime() + service.bookingRules.minNoticeHours * 3600_000);
  const horizon = new Date(now.getTime() + days * 86400_000);
  const busy = await busyIntervals(db, now, new Date(horizon.getTime() + 86400_000), now, opts.excludeBookingId);

  const slots: Slot[] = [];
  for (let d = 0; d <= days; d++) {
    const day = wallClock(new Date(now.getTime() + d * 86400_000), tz);
    const dayStart = zonedTimeToUtc(day.year, day.month, day.day, 12, 0, tz);
    if (!weekdays.includes(wallClock(dayStart, tz).weekday)) continue;
    for (let mins = startHour * 60; mins + duration <= endHour * 60; mins += step) {
      const start = zonedTimeToUtc(day.year, day.month, day.day, Math.floor(mins / 60), mins % 60, tz);
      const end = new Date(start.getTime() + duration * 60_000);
      if (start < earliest || start > horizon) continue;
      const clash = busy.some((b) => overlaps(new Date(start.getTime() - buffer), new Date(end.getTime() + buffer), b.start, b.end));
      if (!clash) slots.push({ start, end });
    }
  }
  return slots;
}

/* ------------------------------------------------------------------ */
/* Booking                                                            */
/* ------------------------------------------------------------------ */

export const BookingRequestSchema = z.object({
  serviceId: z.string().min(1).max(80),
  startsAt: z.coerce.date(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(40).optional(),
  clientTimezone: z.string().refine(isValidTimeZone, "Invalid time zone"),
  participants: z.number().int().min(1).max(50).default(1),
  marketingConsent: z.boolean().default(false),
  acceptedTerms: z.literal(true, { errorMap: () => ({ message: "Please accept the terms and cancellation policy" }) }),
});

export class BookingError extends Error {
  constructor(public code: "conflict" | "unavailable" | "invalid" | "requires_discovery", msg: string) {
    super(msg);
  }
}

/**
 * Creates a booking. Free services confirm immediately; paid services return a hosted
 * checkout URL and are confirmed only by a VERIFIED payment webhook.
 * Idempotent: the same idempotencyKey returns the original booking (no duplicate charge).
 */
export async function requestBooking(db: DB, input: z.input<typeof BookingRequestSchema>, idempotencyKey: string, now = new Date()) {
  const [prior] = await db.select().from(bookings).where(eq(bookings.idempotencyKey, idempotencyKey));
  if (prior) return { bookingId: prior.id, status: prior.status, checkoutUrl: null as string | null, duplicate: true };

  const req = BookingRequestSchema.parse(input);
  const service = await getService(db, req.serviceId);
  if (!service || !["active", "proposed"].includes(service.status)) throw new BookingError("unavailable", "This service is not currently bookable");
  if (req.participants > service.capacity) throw new BookingError("invalid", `Maximum ${service.capacity} participants`);

  const contact = await upsertContact(db, { name: req.name, email: req.email, phone: req.phone, source: "booking", timezone: req.clientTimezone, marketingConsent: req.marketingConsent, consentSource: "booking_form_checkbox" });

  if (service.bookingRules.requiresDiscoveryCall) {
    const prev = await db.select().from(bookings).where(and(eq(bookings.contactId, contact.id), eq(bookings.serviceId, "discovery-call")));
    if (!prev.some((b) => b.status === "completed" || b.status === "confirmed")) {
      throw new BookingError("requires_discovery", "This experience begins with a complimentary discovery call so Felicia can make sure it's right for you.");
    }
  }

  const slots = await availableSlots(db, service, { now, days: service.bookingRules.maxAdvanceDays });
  const slot = slots.find((s) => s.start.getTime() === req.startsAt.getTime());
  if (!slot) throw new BookingError("conflict", "That time is no longer available. Please choose another.");

  const amountMinor = service.priceUnit === "per_participant" ? service.priceMinor * req.participants : service.priceMinor;
  const bookingId = newId("bkg");
  const correlationId = newId("cor");
  const free = amountMinor === 0;

  await db.insert(bookings).values({
    id: bookingId,
    contactId: contact.id,
    serviceId: service.id,
    startsAt: slot.start,
    endsAt: slot.end,
    clientTimezone: req.clientTimezone,
    participants: req.participants,
    status: free ? "confirmed" : "pending_payment",
    amountMinor,
    currency: service.currency,
    idempotencyKey,
  });

  // Re-check for a race: another request may have taken the slot between our check and insert.
  const clash = await db
    .select()
    .from(bookings)
    .where(and(inArray(bookings.status, [...ACTIVE_STATUSES]), lt(bookings.startsAt, slot.end), gt(bookings.endsAt, slot.start)));
  const winner = clash.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0];
  if (winner && winner.id !== bookingId) {
    await db.update(bookings).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(bookings.id, bookingId));
    throw new BookingError("conflict", "That time was just taken. Please choose another.");
  }

  await audit(db, { actor: "public:web", action: "booking.requested", target: bookingId, correlationId, metadata: { serviceId: service.id, amountMinor } });

  if (free) {
    await publish(db, "BOOKING_CONFIRMED", { bookingId }, { correlationId, idempotencyKey: bookingId });
    return { bookingId, status: "confirmed" as const, checkoutUrl: null, duplicate: false };
  }

  const checkout = await paymentProvider().createCheckout({
    reference: bookingId,
    description: service.name,
    amountMinor,
    currency: service.currency,
    customerEmail: normaliseEmail(req.email),
    successUrl: `${env().APP_URL}/book/thank-you?booking=${bookingId}`,
    cancelUrl: `${env().APP_URL}/book?service=${service.id}&cancelled=1`,
    idempotencyKey: `checkout:${bookingId}`,
  });
  await publish(db, "BOOKING_REQUESTED", { bookingId }, { correlationId, idempotencyKey: bookingId });
  return { bookingId, status: "pending_payment" as const, checkoutUrl: checkout.url, duplicate: false };
}

export async function cancelBooking(db: DB, bookingId: string, actor: string, reason: string) {
  const [b] = await db.update(bookings).set({ status: "cancelled", cancelledAt: new Date() }).where(and(eq(bookings.id, bookingId), inArray(bookings.status, [...ACTIVE_STATUSES]))).returning();
  if (!b) throw new BookingError("invalid", "Booking not found or not active");
  if (b.calendarEventId) await calendarProvider().deleteEvent(b.calendarEventId);
  await publish(db, "BOOKING_CANCELLED", { bookingId, reason }, { correlationId: newId("cor"), idempotencyKey: bookingId });
  await audit(db, { actor, action: "booking.cancelled", target: bookingId, metadata: { reason } });
  return b;
}

export async function rescheduleBooking(db: DB, bookingId: string, newStart: Date, actor: string, now = new Date()) {
  const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!b || b.status !== "confirmed") throw new BookingError("invalid", "Only confirmed bookings can be rescheduled");
  const service = await getService(db, b.serviceId);
  if (!service) throw new BookingError("invalid", "Service missing");
  const duration = b.endsAt.getTime() - b.startsAt.getTime();
  const slots = await availableSlots(db, service, { now, days: service.bookingRules.maxAdvanceDays, excludeBookingId: b.id });
  if (!slots.some((s) => s.start.getTime() === newStart.getTime())) throw new BookingError("conflict", "That time is not available");
  const previous = b.startsAt;
  await db.update(bookings).set({ startsAt: newStart, endsAt: new Date(newStart.getTime() + duration) }).where(eq(bookings.id, bookingId));
  if (b.calendarEventId) await calendarProvider().deleteEvent(b.calendarEventId);
  await db.update(bookings).set({ calendarEventId: null }).where(eq(bookings.id, bookingId));
  await publish(db, "BOOKING_RESCHEDULED", { bookingId, previousStartsAt: previous.toISOString() }, { correlationId: newId("cor"), idempotencyKey: `${bookingId}:${newStart.toISOString()}` });
  await audit(db, { actor, action: "booking.rescheduled", target: bookingId, metadata: { from: previous.toISOString(), to: newStart.toISOString() } });
}

/* ------------------------------------------------------------------ */
/* Consent & intake (sensitive, encrypted, owner-only)                */
/* ------------------------------------------------------------------ */

export const CONSENT_VERSION = "2026-10-draft-1";

export const IntakeSchema = z.object({
  bookingId: z.string(),
  intentions: z.string().max(3000).optional(),
  emergencyContact: z.string().max(200).optional(),
  breathwork: z
    .object({
      pregnant: z.boolean(),
      cardiovascular: z.boolean(),
      epilepsyOrSeizures: z.boolean(),
      respiratory: z.boolean(),
      recentSurgery: z.boolean(),
      severeMentalHealth: z.boolean(),
      other: z.string().max(1000).optional(),
    })
    .optional(),
  consents: z.object({
    understandsNotMedical: z.literal(true),
    agreesToTerms: z.literal(true),
    mayStopAnyTime: z.literal(true),
  }),
});

/** Any "yes" on breathwork screening → Felicia reviews before the session. Agents never interpret answers. */
export function breathworkNeedsReview(b: z.infer<typeof IntakeSchema>["breathwork"]) {
  if (!b) return false;
  return b.pregnant || b.cardiovascular || b.epilepsyOrSeizures || b.respiratory || b.recentSurgery || b.severeMentalHealth || !!b.other?.trim();
}

export async function submitIntake(db: DB, input: z.input<typeof IntakeSchema>) {
  const intake = IntakeSchema.parse(input);
  const key = env().DATA_ENCRYPTION_KEY;
  if (!key) throw new Error("DATA_ENCRYPTION_KEY is not configured — intake cannot be stored safely");
  const [b] = await db.select().from(bookings).where(eq(bookings.id, intake.bookingId));
  if (!b) throw new Error("Booking not found");
  const service = await getService(db, b.serviceId);
  const requiresReview = !!service?.bookingRules.breathworkScreening && breathworkNeedsReview(intake.breathwork);
  const id = newId("int");
  await db.insert(intakeRecords).values({
    id,
    bookingId: b.id,
    encryptedPayload: encryptJson(intake, key),
    consentVersion: CONSENT_VERSION,
    consentSignedAt: new Date(),
    requiresReview,
  });
  await publish(db, "INTAKE_SUBMITTED", { intakeId: id, bookingId: b.id, requiresReview }, { correlationId: newId("cor"), idempotencyKey: id });
  await audit(db, { actor: "client", action: "intake.submitted", target: b.id, metadata: { requiresReview } }); // no answers in audit
  return { intakeId: id, requiresReview };
}

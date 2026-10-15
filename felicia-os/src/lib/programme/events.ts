import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import { agentTasks, contacts, eventRegistrations, programmeEvents, services } from "../db/schema";
import { upsertContact, PENDING_HOLD_MINUTES } from "../booking/booking";
import { paymentProvider } from "../payments/provider";
import { publish } from "../events/bus";
import { audit } from "../audit/audit";
import { env } from "../config/env";
import { newId, normaliseEmail } from "../util";
import { syncEventMeeting } from "../video/meetings";

/**
 * Workshops, group experiences and Return to Wonder: self-service registration.
 *
 * Seats counted against capacity = confirmed + attended + unpaid holds still inside
 * the hold window. Free events confirm immediately; paid events go through the hosted
 * checkout and are confirmed only by a verified payment webhook.
 */

export type ProgrammeEvent = typeof programmeEvents.$inferSelect;
export type Registration = typeof eventRegistrations.$inferSelect;

export const EVENT_STATUSES = ["planning", "open", "full", "closed", "completed", "cancelled"] as const;

export class EventError extends Error {
  constructor(public code: "unavailable" | "full" | "already_registered" | "invalid", msg: string) {
    super(msg);
  }
}

const holdActive = (r: Registration, now: Date) => r.status === "pending_payment" && now.getTime() - r.holdStartedAt.getTime() < PENDING_HOLD_MINUTES * 60_000;
const occupiesSeat = (r: Registration, now: Date) => r.status === "confirmed" || r.status === "attended" || holdActive(r, now);

export async function getEvent(db: DB, id: string) {
  const [ev] = await db.select().from(programmeEvents).where(eq(programmeEvents.id, id));
  return ev;
}

export async function seatsTaken(db: DB, eventId: string, now = new Date()) {
  const regs = await db.select().from(eventRegistrations).where(eq(eventRegistrations.eventId, eventId));
  return regs.filter((r) => occupiesSeat(r, now)).length;
}

/** Events visitors can see: open or full, not yet started. Optionally only one type (e.g. Return to Wonder). */
export async function publicEvents(db: DB, now = new Date(), opts: { serviceId?: string } = {}) {
  const rows = await db.select().from(programmeEvents).where(inArray(programmeEvents.status, ["open", "full"])).orderBy(asc(programmeEvents.startsAt));
  const upcoming = rows.filter((e) => e.startsAt > now && (!opts.serviceId || e.serviceId === opts.serviceId));
  return Promise.all(upcoming.map(async (e) => ({ ...e, seatsLeft: Math.max(0, e.capacity - (await seatsTaken(db, e.id, now))) })));
}

/** Keeps an event's open/full status in step with confirmed registrations. */
export async function refreshEventStatus(db: DB, eventId: string, now = new Date()) {
  const ev = await getEvent(db, eventId);
  if (!ev || !["open", "full"].includes(ev.status)) return ev?.status;
  const taken = await seatsTaken(db, eventId, now);
  const next = taken >= ev.capacity ? "full" : "open";
  if (next !== ev.status) await db.update(programmeEvents).set({ status: next }).where(eq(programmeEvents.id, eventId));
  return next;
}

/* ------------------------------------------------------------------ */
/* Admin: create and edit events                                      */
/* ------------------------------------------------------------------ */

export const EventInputSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(5000).default(""),
    serviceId: z.string().max(80).nullable().default(null),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    location: z.string().trim().min(2).max(300),
    capacity: z.number().int().min(1).max(500),
    priceMinor: z.number().int().min(0).max(10_000_000),
    budgetMinor: z.number().int().min(0).max(100_000_000).default(0),
    includesBreathwork: z.boolean().default(false),
    isOnline: z.boolean().default(false),
    status: z.enum(EVENT_STATUSES).default("planning"),
  })
  .refine((e) => e.endsAt > e.startsAt, { message: "The event must end after it starts", path: ["endsAt"] });

const DEFAULT_CHECKLIST = ["Venue confirmed (approval recorded)", "Insurance covers this event", "Risk assessment done", "Joining / travel details sent", "Materials prepared"].map((item) => ({ item, done: false }));

/**
 * A signed-in owner/admin/staff member creating an event is a human decision.
 * Venue bookings, supplier spend and agreements stay outside the system and, when an
 * agent proposes them, go through approvals (venue.book, money.spend, agreement.sign).
 */
/** The kinds of experience an event can be listed under (shown on that experience's page). */
export async function eventTypes(db: DB) {
  return (await db.select({ id: services.id, name: services.name, category: services.category }).from(services).orderBy(asc(services.sortOrder))).filter(
    (s) => s.category === "Groups & workshops" || s.category === "Healing adventures",
  );
}

async function assertEventType(db: DB, serviceId: string | null | undefined) {
  if (!serviceId) return;
  if (!(await eventTypes(db)).some((t) => t.id === serviceId)) throw new EventError("invalid", "Please choose a valid event type");
}

export async function createEvent(db: DB, input: z.input<typeof EventInputSchema>, actor: string) {
  const e = EventInputSchema.parse(input);
  await assertEventType(db, e.serviceId);
  const id = newId("evn");
  await db.insert(programmeEvents).values({ id, ...e, checklist: DEFAULT_CHECKLIST });
  await audit(db, { actor, action: "event.created", target: id, metadata: { title: e.title, status: e.status, capacity: e.capacity, priceMinor: e.priceMinor } });
  return id;
}

export const EventPatchSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(5000),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    location: z.string().trim().min(2).max(300),
    capacity: z.number().int().min(1).max(500),
    priceMinor: z.number().int().min(0).max(10_000_000),
    budgetMinor: z.number().int().min(0).max(100_000_000),
    includesBreathwork: z.boolean(),
    isOnline: z.boolean(),
    status: z.enum(EVENT_STATUSES),
    serviceId: z.string().max(80).nullable(),
    checklist: z.array(z.object({ item: z.string().min(1).max(200), done: z.boolean() })).max(40),
  })
  .partial();

export async function updateEvent(db: DB, id: string, patch: z.input<typeof EventPatchSchema>, actor: string) {
  const p = EventPatchSchema.parse(patch);
  const ev = await getEvent(db, id);
  if (!ev) throw new EventError("invalid", "Event not found");
  await assertEventType(db, p.serviceId);
  const startsAt = p.startsAt ?? ev.startsAt;
  const endsAt = p.endsAt ?? ev.endsAt;
  if (endsAt <= startsAt) throw new EventError("invalid", "The event must end after it starts");
  const confirmed = (await db.select().from(eventRegistrations).where(eq(eventRegistrations.eventId, id))).filter((r) => r.status === "confirmed" || r.status === "attended").length;
  if (p.capacity !== undefined && p.capacity < confirmed) throw new EventError("invalid", `Capacity can't go below the ${confirmed} people already confirmed`);
  if (p.priceMinor !== undefined && p.priceMinor !== ev.priceMinor && confirmed > 0) {
    // Existing registrants keep what they paid; new registrants pay the new price.
    await audit(db, { actor, action: "event.price_changed_with_registrants", target: id, metadata: { from: ev.priceMinor, to: p.priceMinor, confirmed } });
  }
  await db.update(programmeEvents).set(p).where(eq(programmeEvents.id, id));
  await audit(db, { actor, action: "event.updated", target: id, metadata: { fields: Object.keys(p), status: p.status } });
  if (p.capacity !== undefined || p.status === "open") await refreshEventStatus(db, id);
  // Keep the shared Zoom meeting in step: new time/title, or delete it if cancelled or no longer online.
  if (["startsAt", "endsAt", "title", "status", "isOnline"].some((k) => k in p)) {
    const sync = await syncEventMeeting(db, id, actor);
    if (!sync.ok) return { ...(await getEvent(db, id))!, videoWarning: sync.message };
  }
  return getEvent(db, id);
}

export async function eventRoster(db: DB, eventId: string) {
  return db
    .select({ r: eventRegistrations, c: contacts })
    .from(eventRegistrations)
    .innerJoin(contacts, eq(eventRegistrations.contactId, contacts.id))
    .where(eq(eventRegistrations.eventId, eventId))
    .orderBy(asc(eventRegistrations.createdAt));
}

/* ------------------------------------------------------------------ */
/* Public: register                                                   */
/* ------------------------------------------------------------------ */

export const RegistrationSchema = z.object({
  eventId: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(40).optional(),
  marketingConsent: z.boolean().default(false),
  acceptedTerms: z.literal(true, { errorMap: () => ({ message: "Please accept the terms and cancellation policy" }) }),
  healthAcknowledged: z.boolean().default(false),
});

export async function registerForEvent(db: DB, input: z.input<typeof RegistrationSchema>, now = new Date()) {
  const req = RegistrationSchema.parse(input);
  const ev = await getEvent(db, req.eventId);
  if (!ev || ev.startsAt <= now || !["open", "full"].includes(ev.status)) throw new EventError("unavailable", "Registration for this event isn't open.");
  if (ev.includesBreathwork && !req.healthAcknowledged) throw new EventError("invalid", "Please confirm you've read the breathwork health note.");

  const contact = await upsertContact(db, { name: req.name, email: req.email, phone: req.phone, source: "event", sourceDetail: ev.id, marketingConsent: req.marketingConsent, consentSource: "event_registration_checkbox" });
  const [existing] = await db.select().from(eventRegistrations).where(and(eq(eventRegistrations.eventId, ev.id), eq(eventRegistrations.contactId, contact.id)));
  if (existing && (existing.status === "confirmed" || existing.status === "attended")) throw new EventError("already_registered", "You're already registered for this event. Check your inbox for the details.");

  const free = ev.priceMinor === 0;
  const status = free ? "confirmed" : "pending_payment";
  let regId: string;
  let resumed = false;
  if (existing && holdActive(existing, now)) {
    // Same person retrying while their place is still held: reuse it (no second seat, no second charge).
    regId = existing.id;
    resumed = true;
  } else if (existing) {
    regId = existing.id;
    await db.update(eventRegistrations).set({ status, amountMinor: ev.priceMinor, holdStartedAt: now, cancelledAt: null }).where(eq(eventRegistrations.id, regId));
  } else {
    regId = newId("reg");
    await db.insert(eventRegistrations).values({ id: regId, eventId: ev.id, contactId: contact.id, status, amountMinor: ev.priceMinor, holdStartedAt: now });
  }

  if (!resumed) {
    // Capacity check after writing, so two people racing for the last place can't both get it:
    // seats go in order of when the hold started; anyone past capacity is released.
    const regs = (await db.select().from(eventRegistrations).where(eq(eventRegistrations.eventId, ev.id))).filter((r) => occupiesSeat(r, now));
    regs.sort((a, b) => (a.status === "confirmed" || a.status === "attended" ? 0 : 1) - (b.status === "confirmed" || b.status === "attended" ? 0 : 1) || a.holdStartedAt.getTime() - b.holdStartedAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    if (regs.findIndex((r) => r.id === regId) >= ev.capacity) {
      await db.update(eventRegistrations).set({ status: "cancelled", cancelledAt: now }).where(eq(eventRegistrations.id, regId));
      await refreshEventStatus(db, ev.id, now);
      throw new EventError("full", "Sorry, this event is now full. Get in touch and we'll let you know if a place opens up.");
    }
    const correlationId = newId("cor");
    await publish(db, "EVENT_REGISTRATION_CREATED", { registrationId: regId, eventId: ev.id }, { correlationId, idempotencyKey: `${regId}:${now.getTime()}` });
    await audit(db, { actor: "public:web", action: "event.registration_created", target: regId, correlationId, metadata: { eventId: ev.id, free } });
    await refreshEventStatus(db, ev.id, now);
  }

  if (free) return { registrationId: regId, status: "confirmed" as const, checkoutUrl: null as string | null };

  const [reg] = await db.select().from(eventRegistrations).where(eq(eventRegistrations.id, regId));
  const checkout = await paymentProvider().createCheckout({
    reference: regId,
    description: ev.title,
    amountMinor: ev.priceMinor,
    currency: "GBP",
    customerEmail: normaliseEmail(req.email),
    successUrl: `${env().APP_URL}/events/${ev.id}?registered=1`,
    cancelUrl: `${env().APP_URL}/events/${ev.id}?cancelled=1`,
    idempotencyKey: `checkout:${regId}:${reg!.holdStartedAt.getTime()}`,
  });
  return { registrationId: regId, status: "pending_payment" as const, checkoutUrl: checkout.url };
}

/**
 * Called after a VERIFIED payment. A payment that arrives after the hold expired is
 * still honoured: the person paid, so they get their place, and Felicia is alerted if
 * that takes the event over capacity.
 */
export async function confirmRegistrationAfterPayment(db: DB, registrationId: string, correlationId: string) {
  const [reg] = await db.select().from(eventRegistrations).where(eq(eventRegistrations.id, registrationId));
  if (!reg) throw new Error(`Registration ${registrationId} not found`);
  if (reg.status === "confirmed" || reg.status === "attended") return { confirmed: true, overCapacity: false };
  await db.update(eventRegistrations).set({ status: "confirmed", cancelledAt: null }).where(eq(eventRegistrations.id, registrationId));
  const ev = (await getEvent(db, reg.eventId))!;
  const confirmed = (await db.select().from(eventRegistrations).where(eq(eventRegistrations.eventId, ev.id))).filter((r) => r.status === "confirmed" || r.status === "attended").length;
  const overCapacity = confirmed > ev.capacity;
  if (overCapacity) {
    await db.insert(agentTasks).values({
      id: newId("tsk"),
      agentId: "events",
      kind: "owner_attention",
      status: "blocked",
      correlationId,
      input: { summary: `${ev.title} now has ${confirmed} paid places for a capacity of ${ev.capacity} (a payment arrived after a hold expired). Decide whether to make room or offer a refund.`, eventId: ev.id },
    });
  }
  await refreshEventStatus(db, ev.id);
  return { confirmed: true, overCapacity };
}

/** Owner/admin cancels a registration. Paid places are not refunded automatically; raise a refund request for approval. */
export async function cancelRegistration(db: DB, registrationId: string, actor: string, reason: string) {
  const [reg] = await db
    .update(eventRegistrations)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(and(eq(eventRegistrations.id, registrationId), inArray(eventRegistrations.status, ["pending_payment", "confirmed"])))
    .returning();
  if (!reg) throw new EventError("invalid", "Registration not found or already cancelled");
  await audit(db, { actor, action: "event.registration_cancelled", target: registrationId, metadata: { reason, eventId: reg.eventId } });
  await refreshEventStatus(db, reg.eventId);
  return reg;
}

/** Releases unpaid holds past the hold window (called by the scheduler). */
export async function expireRegistrationHolds(db: DB, now = new Date()) {
  const pending = await db.select().from(eventRegistrations).where(eq(eventRegistrations.status, "pending_payment"));
  const stale = pending.filter((r) => !holdActive(r, now));
  for (const r of stale) {
    await db.update(eventRegistrations).set({ status: "cancelled", cancelledAt: now }).where(and(eq(eventRegistrations.id, r.id), eq(eventRegistrations.status, "pending_payment")));
  }
  for (const eventId of new Set(stale.map((r) => r.eventId))) await refreshEventStatus(db, eventId, now);
  return { expired: stale.length };
}

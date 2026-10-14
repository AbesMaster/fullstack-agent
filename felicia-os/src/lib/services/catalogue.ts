import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { services, type BookingRules } from "../db/schema";
import { audit } from "../audit/audit";

export type Service = typeof services.$inferSelect;

const STANDARD_AVAILABILITY = { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, timezone: "Europe/London" };
const NO_VAT = { vatRegistered: false, ratePercent: 0, inclusive: true };
const rules = (r: Partial<BookingRules> = {}): BookingRules => ({
  minNoticeHours: 24,
  maxAdvanceDays: 90,
  bufferMinutes: 30,
  requiresDiscoveryCall: false,
  requiresIntake: true,
  breathworkScreening: true,
  ...r,
});
const STANDARD_CANCELLATION =
  "Free rescheduling or a full refund up to 48 hours before your session. Within 48 hours, sessions may be rescheduled once; refunds are at Felicia's discretion. [DRAFT — awaiting owner and legal review]";

/**
 * The directive's catalogue. ALL prices are PROPOSED and await owner approval
 * (ownerApprovedPrice=false, status="proposed"). Nothing here is presented to
 * the public as final until Felicia approves it in the Command Center.
 */
type CatalogueEntry = Omit<typeof services.$inferInsert, "currency" | "status" | "ownerApprovedPrice" | "taxConfig" | "availability">;

const ENTRIES: CatalogueEntry[] = [
  {
    id: "discovery-call",
    name: "Discovery Call",
    category: "Getting started",
    description:
      "A relaxed 20-minute conversation to understand where you are, what you are looking for, and whether working together feels right. No obligation.",
    durationMinutes: 20,
    priceMinor: 0,
    deliveryMode: "online",
    bookingRules: rules({ minNoticeHours: 12, bufferMinutes: 10, requiresIntake: false, breathworkScreening: false }),
    cancellationTerms: "Please let us know if you can no longer attend so the time can be offered to someone else.",
    capacity: 1,
    sortOrder: 1,
  },
  {
    id: "personal-alignment-session",
    name: "Personal Alignment Session",
    category: "Private sessions",
    description:
      "A focused one-to-one session to pause, reflect and reconnect with what matters to you, drawing on breathwork, emotional awareness and Star Magic-inspired practices.",
    durationMinutes: 60,
    priceMinor: 22200,
    deliveryMode: "hybrid",
    bookingRules: rules(),
    cancellationTerms: STANDARD_CANCELLATION,
    sortOrder: 2,
  },
  {
    id: "signature-private-session",
    name: "Signature Private Session",
    category: "Private sessions",
    description:
      "Felicia's signature 90-minute experience: unhurried space for deeper exploration, guided breathwork and integration of what arises.",
    durationMinutes: 90,
    priceMinor: 33300,
    deliveryMode: "hybrid",
    bookingRules: rules(),
    cancellationTerms: STANDARD_CANCELLATION,
    sortOrder: 3,
  },
  {
    id: "premium-private-experience",
    name: "Premium Private Experience",
    category: "Private sessions",
    description:
      "An extended two-hour private experience with time for preparation, a full session, and gentle integration before you return to your day.",
    durationMinutes: 120,
    priceMinor: 55500,
    deliveryMode: "in_person",
    bookingRules: rules({ requiresDiscoveryCall: true }),
    cancellationTerms: STANDARD_CANCELLATION,
    sortOrder: 4,
  },
  {
    id: "couples-experience",
    name: "Couples Experience",
    category: "Couples",
    description:
      "A two-hour shared experience for partners who want to slow down, listen to one another and reconnect with intention.",
    durationMinutes: 120,
    priceMinor: 66600,
    deliveryMode: "in_person",
    bookingRules: rules({ requiresDiscoveryCall: true }),
    cancellationTerms: STANDARD_CANCELLATION,
    capacity: 2,
    priceUnit: "per_booking",
    sortOrder: 5,
  },
  {
    id: "four-session-journey",
    name: "Four-Session Transformation Journey",
    category: "Programmes",
    description:
      "Four private sessions over around six weeks, building a steady rhythm of reflection, practice and integration.",
    durationMinutes: 90,
    priceMinor: 111100,
    priceUnit: "per_programme",
    deliveryMode: "hybrid",
    bookingRules: rules({ requiresDiscoveryCall: true, maxAdvanceDays: 120 }),
    cancellationTerms: STANDARD_CANCELLATION,
    sortOrder: 6,
  },
  {
    id: "eight-week-programme",
    name: "Eight-Week Personal Development Programme",
    category: "Programmes",
    description:
      "An eight-week guided programme combining private sessions, between-session practices and check-ins to support lasting personal change.",
    durationMinutes: 60,
    priceMinor: 222200,
    priceUnit: "per_programme",
    deliveryMode: "hybrid",
    bookingRules: rules({ requiresDiscoveryCall: true, maxAdvanceDays: 120 }),
    cancellationTerms: STANDARD_CANCELLATION,
    sortOrder: 7,
  },
  {
    id: "online-group-experience",
    name: "Online Group Experience",
    category: "Groups & workshops",
    description: "A live online group session: guided breathwork, reflection and community, from wherever you are.",
    durationMinutes: 90,
    priceMinor: 4400,
    priceUnit: "per_participant",
    deliveryMode: "online",
    bookingRules: rules({ minNoticeHours: 2, bufferMinutes: 0 }),
    cancellationTerms: "Full refund up to 24 hours before the session start. [DRAFT]",
    capacity: 20,
    sortOrder: 8,
  },
  {
    id: "half-day-workshop",
    name: "Half-Day Workshop",
    category: "Groups & workshops",
    description: "A half-day in-person workshop exploring breathwork, emotional awareness and conscious living in a small group.",
    durationMinutes: 240,
    priceMinor: 11100,
    priceMaxMinor: 22200,
    priceUnit: "per_participant",
    deliveryMode: "in_person",
    bookingRules: rules({ minNoticeHours: 24, bufferMinutes: 0 }),
    cancellationTerms: "Full refund up to 7 days before the workshop. Transfers to a future date are welcome. [DRAFT]",
    capacity: 16,
    sortOrder: 9,
  },
  {
    id: "return-to-wonder",
    name: "Return to Wonder",
    category: "Healing adventures",
    description:
      "Felicia's signature experience. Step outside, slow down and rediscover a sense of wonder through nature, breath and connection. Explore the Earth. Open the Heart. Remember Who You Are.",
    durationMinutes: null,
    priceMinor: 33300,
    priceMaxMinor: 55500,
    priceUnit: "per_participant",
    deliveryMode: "in_person",
    bookingRules: rules({ minNoticeHours: 72, bufferMinutes: 0 }),
    cancellationTerms: "Refund terms depend on venue and supplier commitments and are confirmed at registration. [DRAFT]",
    capacity: 12,
    sortOrder: 10,
  },
];

export const DEFAULT_CATALOGUE: (typeof services.$inferInsert)[] = ENTRIES.map((s) => ({
  ...s,
  currency: "GBP",
  status: "proposed" as const,
  ownerApprovedPrice: false,
  taxConfig: NO_VAT,
  availability: STANDARD_AVAILABILITY,
}));

export async function seedCatalogue(db: DB) {
  await db.insert(services).values(DEFAULT_CATALOGUE).onConflictDoNothing();
}

export async function listServices(db: DB, opts: { publicOnly?: boolean } = {}): Promise<Service[]> {
  const rows = await db.select().from(services).orderBy(asc(services.sortOrder));
  // Public site shows proposed + active (proposed carries a visible "pricing being finalised" note).
  return opts.publicOnly ? rows.filter((r) => r.status === "active" || r.status === "proposed") : rows;
}

export async function getService(db: DB, id: string): Promise<Service | undefined> {
  const [row] = await db.select().from(services).where(eq(services.id, id));
  return row;
}

export const ServiceUpdateSchema = z
  .object({
    name: z.string().min(2).max(120),
    description: z.string().min(10).max(2000),
    durationMinutes: z.number().int().min(5).max(60 * 24 * 14).nullable(),
    priceMinor: z.number().int().min(0).max(10_000_000),
    priceMaxMinor: z.number().int().min(0).max(10_000_000).nullable(),
    capacity: z.number().int().min(1).max(500),
    status: z.enum(["proposed", "active", "paused", "archived"]),
    cancellationTerms: z.string().min(5).max(2000),
  })
  .partial()
  .refine((v) => v.priceMaxMinor == null || v.priceMinor == null || v.priceMaxMinor >= v.priceMinor, {
    message: "Maximum price must be at least the minimum price",
  });

/**
 * Price changes are approval-gated for AGENTS (see agents/permissions), but an
 * authenticated owner/admin editing here IS the human approval — so direct edits
 * by owner/admin are allowed and audited. Making a service "active" marks its price owner-approved.
 */
export async function updateService(db: DB, id: string, patch: z.infer<typeof ServiceUpdateSchema>, actor: string) {
  const parsed = ServiceUpdateSchema.parse(patch);
  const before = await getService(db, id);
  if (!before) throw new Error(`Unknown service ${id}`);
  const ownerApprovedPrice = parsed.status === "active" ? true : parsed.priceMinor !== undefined && parsed.priceMinor !== before.priceMinor ? true : before.ownerApprovedPrice;
  await db
    .update(services)
    .set({ ...parsed, ownerApprovedPrice, updatedAt: new Date() })
    .where(eq(services.id, id));
  await audit(db, {
    actor,
    action: "service.updated",
    target: id,
    metadata: { before: { priceMinor: before.priceMinor, status: before.status }, patch: parsed },
  });
  return getService(db, id);
}

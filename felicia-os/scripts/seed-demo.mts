/**
 * DEMO ENVIRONMENT ONLY. Seeds clearly labelled FICTIONAL data so the Command Center
 * can be explored. Refuses to run in production or against DATABASE_URL unless DEMO_ALLOW_REMOTE=1.
 * Every fictional person uses an @example.test address and the "(DEMO)" suffix.
 */
import { createDb, migrate } from "../src/lib/db/client.ts";
import { seedCatalogue } from "../src/lib/services/catalogue.ts";
import { createUser } from "../src/lib/auth/auth.ts";
import { createEnquiry, requestBooking } from "../src/lib/booking/booking.ts";
import { applyPaymentEvent } from "../src/lib/payments/processing.ts";
import { buildBus } from "../src/lib/agents/workflows.ts";
import { createDraft, submitForApproval } from "../src/lib/content/pipeline.ts";
import { ingestDocument } from "../src/lib/knowledge/knowledge.ts";
import { availableSlots } from "../src/lib/booking/booking.ts";
import { getService } from "../src/lib/services/catalogue.ts";
import { expenses, users } from "../src/lib/db/schema.ts";
import { env } from "../src/lib/config/env.ts";
import { eq } from "drizzle-orm";

if (env().APP_ENV === "production") throw new Error("Refusing to seed demo data in production");
if (env().DATABASE_URL && process.env.DEMO_ALLOW_REMOTE !== "1") throw new Error("Refusing to seed a remote database without DEMO_ALLOW_REMOTE=1");

const db = await createDb();
await migrate(db);
await seedCatalogue(db);
const bus = buildBus();
const drain = async () => { for (let i = 0; i < 10; i++) { const r = await bus.drain(db); if (!r.processed && !r.failed) break; } };

const [existing] = await db.select().from(users).where(eq(users.email, "demo-owner@example.test"));
if (!existing) {
  const r = await createUser(db, { email: "demo-owner@example.test", name: "Demo Owner (DEMO)", role: "owner", password: "demo-password-not-for-production" });
  console.log("Demo owner: demo-owner@example.test / demo-password-not-for-production");
  console.log("Authenticator setup URL:", r.otpauthUrl);
}

await ingestDocument(db, { title: "Booking basics (DEMO)", section: "L", source: "demo seed", format: "md", owner: "Demo", accessLevel: "public", verificationStatus: "verified" },
  "The discovery call is complimentary, lasts 20 minutes and takes place by video. Sessions can be online or in person in the UK.", "system:demo").catch(() => undefined);

const people = ["Ava", "Ben", "Chloe", "Dev", "Ella", "Finn"].map((n, i) => ({ name: `${n} Sample (DEMO)`, email: `${n.toLowerCase()}@example.test`, i }));
for (const p of people.slice(0, 4)) {
  await createEnquiry(db, { name: p.name, email: p.email, message: p.i % 2 ? "Curious how a private session works — fictional demo enquiry." : "What does the signature session cost and when are you available? (demo)", marketingConsent: p.i % 2 === 0 }, `demo-enq-${p.email}`);
}
const disc = (await getService(db, "discovery-call"))!;
const sig = (await getService(db, "signature-private-session"))!;
const dSlots = await availableSlots(db, disc, { days: 14 });
const sSlots = await availableSlots(db, sig, { days: 14 });
for (const [k, p] of people.slice(0, 3).entries()) {
  await requestBooking(db, { serviceId: "discovery-call", startsAt: dSlots[k * 5]!.start, name: p.name, email: p.email, clientTimezone: "Europe/London", acceptedTerms: true }, `demo-disc-${p.email}`).catch(() => undefined);
}
const paid = await requestBooking(db, { serviceId: "signature-private-session", startsAt: sSlots[12]!.start, name: people[4]!.name, email: people[4]!.email, clientTimezone: "Europe/London", acceptedTerms: true }, "demo-paid-1").catch(() => undefined);
if (paid && !paid.duplicate) {
  await applyPaymentEvent(db, "mock", { kind: "payment_succeeded", providerEventId: "demo_evt_1", providerRef: "demo_pi_1", reference: paid.bookingId, amountMinor: 33300, feeMinor: 520, currency: "GBP" });
}
await db.insert(expenses).values({ id: "exp_demo_1", category: "software", description: "Website hosting (DEMO)", amountMinor: 2000, incurredOn: new Date().toISOString().slice(0, 10) }).onConflictDoNothing();
const draft = await createDraft(db, "content-strategy", { channel: "instagram", category: "Breathwork Education", format: "caption", title: "Three-breath pause (DEMO)", body: "Before your next meeting, try three slow breaths: in for four, out for six. Notice what softens. Breathwork isn't for everyone — check in with your body and your GP if unsure." });
await submitForApproval(db, draft).catch(() => undefined);
await drain();
console.log("Demo data seeded (all fictional, labelled DEMO).");
process.exit(0);

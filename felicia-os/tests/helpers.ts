import { randomBytes } from "node:crypto";
import { resetEnvCache } from "@/lib/config/env";
import { createTestDb, type DB } from "@/lib/db/client";
import { seedCatalogue } from "@/lib/services/catalogue";
import { MockPaymentProvider, setPaymentProviderForTests } from "@/lib/payments/provider";
import { MockCrmProvider, setCrmProviderForTests } from "@/lib/crm/provider";
import { MockCalendarProvider, setCalendarProviderForTests } from "@/lib/calendar/provider";
import { MockTransport, setEmailTransportForTests } from "@/lib/email/send";
import { buildBus } from "@/lib/agents/workflows";
import { services } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type Harness = Awaited<ReturnType<typeof harness>>;

/** Fresh in-memory Postgres (PGlite) + mock providers for each test. All data is fictional. */
export async function harness() {
  process.env.APP_URL = "http://localhost:3000";
  process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters-long";
  delete process.env.DATABASE_URL;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.HUBSPOT_ACCESS_TOKEN;
  resetEnvCache();

  const db = await createTestDb();
  await seedCatalogue(db);
  const payments = new MockPaymentProvider();
  const crm = new MockCrmProvider();
  const calendar = new MockCalendarProvider();
  const email = new MockTransport();
  setPaymentProviderForTests(payments);
  setCrmProviderForTests(crm);
  setCalendarProviderForTests(calendar);
  setEmailTransportForTests(email);
  const bus = buildBus();
  const drainAll = async (now?: Date) => {
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const r = await bus.drain(db, { now });
      total += r.processed;
      if (r.processed + r.failed + r.dead === 0) break;
    }
    return total;
  };
  return { db, payments, crm, calendar, email, bus, drainAll };
}

/** A Monday 08:00 UTC in winter (no DST) — deterministic "now" for availability tests. */
export const MONDAY = new Date("2026-01-05T08:00:00Z");

export async function activate(db: DB, id: string) {
  await db.update(services).set({ status: "active" }).where(eq(services.id, id));
}

import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { services, users } from "../db/schema";
import type { Env } from "../config/env";

/**
 * Launch readiness check ("preflight"). Run before every staging or production deploy:
 *
 *   npm run preflight            configuration, database and content checks
 *   npm run preflight -- --verify  also makes READ-ONLY calls to every connected service
 *
 * Verification never sends, charges, books or publishes anything. A service only counts as
 * "verified" when its live check passes; credentials being present is not enough.
 */

export type Result = "pass" | "warn" | "fail";
export type Check = { area: string; item: string; result: Result; detail: string };

export type Verifiers = {
  stripe?: () => Promise<{ mode: "test" | "live"; webhook: string; target: string }>;
  email?: () => Promise<{ domain: string; status: string }>;
  zoom?: () => Promise<{ host: string; licensed: boolean }>;
  calendar?: () => Promise<{ calendar: string; timeZone: string }>;
  crm?: () => Promise<unknown>;
  claude?: () => Promise<{ missing: string[] }>;
};

export type PreflightInput = {
  env: Env;
  cronSecret?: string;
  /** Contents of the legal pages, to find unresolved [CONFIRM] markers. */
  legalPages?: Record<string, string>;
  verifiers?: Verifiers;
};

export async function runPreflight(db: DB | null, input: PreflightInput): Promise<Check[]> {
  const e = input.env;
  const target = e.APP_ENV;
  const isProd = target === "production";
  const checks: Check[] = [];
  const add = (area: string, item: string, result: Result, detail: string) => checks.push({ area, item, result, detail });
  // In production a gap is a blocker; in staging it's something to fix before launch.
  const gap = isProd ? "fail" : "warn";

  /* ---------- Configuration ---------- */
  if (target === "development") add("Setup", "Environment", "warn", "APP_ENV is 'development'. Set it to 'staging' for the rehearsal or 'production' for launch.");
  else add("Setup", "Environment", "pass", `APP_ENV is '${target}'`);

  let url: URL | null = null;
  try {
    url = new URL(e.APP_URL);
  } catch {
    /* handled below */
  }
  if (!url || url.protocol !== "https:" || /localhost|127\.0\.0\.1/.test(url.hostname)) add("Setup", "Site address", target === "development" ? "warn" : "fail", `APP_URL must be the public https:// address (now: ${e.APP_URL})`);
  else add("Setup", "Site address", "pass", e.APP_URL);

  add("Setup", "Database", e.DATABASE_URL ? "pass" : target === "development" ? "warn" : "fail", e.DATABASE_URL ? "PostgreSQL (DATABASE_URL set)" : "DATABASE_URL is empty, so the built-in development database would be used");
  add("Security", "Session secret", (e.SESSION_SECRET?.length ?? 0) >= 32 ? "pass" : "fail", (e.SESSION_SECRET?.length ?? 0) >= 32 ? "Set" : "SESSION_SECRET must be at least 32 random characters");

  let keyBytes = 0;
  try {
    keyBytes = e.DATA_ENCRYPTION_KEY ? Buffer.from(e.DATA_ENCRYPTION_KEY, "base64").length : 0;
  } catch {
    keyBytes = 0;
  }
  add("Security", "Encryption key", keyBytes === 32 ? "pass" : "fail", keyBytes === 32 ? "Set (keep a secure backup: without it intake forms can't be read)" : "DATA_ENCRYPTION_KEY must be 32 random bytes in base64 (openssl rand -base64 32)");
  add("Automation", "Scheduler secret", (input.cronSecret?.length ?? 0) >= 24 ? "pass" : "fail", (input.cronSecret?.length ?? 0) >= 24 ? "Set" : "CRON_SECRET must be at least 24 random characters so only your scheduler can run background jobs");

  const stripeKey = e.STRIPE_SECRET_KEY ?? "";
  const stripeLive = /^(sk|rk)_live_/.test(stripeKey);
  if (!stripeKey || !e.STRIPE_WEBHOOK_SECRET) add("Payments", "Stripe", "fail", "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are both required");
  else if (isProd && !stripeLive) add("Payments", "Stripe", "fail", "Production is using a TEST key: clients' cards would not be charged");
  else if (!isProd && stripeLive) add("Payments", "Stripe", "fail", "A LIVE key is set outside production: rehearsals would take real money");
  else add("Payments", "Stripe", "pass", `${stripeLive ? "Live" : "Test"} keys set`);

  add("Email", "Email provider", e.EMAIL_PROVIDER_API_KEY ? "pass" : "fail", e.EMAIL_PROVIDER_API_KEY ? `Sending as ${e.EMAIL_FROM}` : "EMAIL_PROVIDER_API_KEY is required: booking confirmations, sign-in links and receipts depend on it");
  const zoom = !!(e.ZOOM_ACCOUNT_ID && e.ZOOM_CLIENT_ID && e.ZOOM_CLIENT_SECRET);
  add("Video", "Zoom", zoom ? "pass" : gap, zoom ? "Credentials set" : "Not connected: online sessions and online events can't get meeting links");
  const cal = !!(e.GOOGLE_CALENDAR_ID && e.GOOGLE_SERVICE_ACCOUNT_JSON);
  add("Calendar", "Google Calendar", cal ? "pass" : "warn", cal ? "Credentials set" : "Not connected: bookings won't check Felicia's personal calendar for clashes");
  add("CRM", "HubSpot", e.HUBSPOT_ACCESS_TOKEN ? "pass" : "warn", e.HUBSPOT_ACCESS_TOKEN ? "Token set" : "Not connected: contacts stay in the Command Center only (fine to launch without)");
  add("AI", "Claude", e.ANTHROPIC_API_KEY ? "pass" : "warn", e.ANTHROPIC_API_KEY ? "API key set" : "Not connected: the website assistant uses simple rule-based answers and agents use templates");
  add("JARVIS", "Parent-system reporting", e.JARVIS_BASE_URL && e.JARVIS_API_TOKEN ? "pass" : "warn", e.JARVIS_BASE_URL && e.JARVIS_API_TOKEN ? "Configured" : "Waiting on the JARVIS OS API specification (optional for launch)");

  /* ---------- Database and accounts ---------- */
  if (db) {
    try {
      await db.execute(sql`select 1`);
      add("Database", "Connection", "pass", "Connected");
      const ext = (await db.execute(sql`select 1 from pg_extension where extname = 'vector'`)) as unknown as { rows?: unknown[]; length?: number };
      const hasVector = (ext.rows?.length ?? ext.length ?? 0) > 0;
      add("Database", "pgvector extension", hasVector ? "pass" : "fail", hasVector ? "Installed" : "Run migrations (npm run db:migrate) on a PostgreSQL that supports pgvector");
      const owners = await db.select().from(users).where(and(eq(users.role, "owner"), eq(users.mfaEnabled, true)));
      add("Accounts", "Owner sign-in", owners.length > 0 ? "pass" : "fail", owners.length > 0 ? `${owners.length} owner account(s) with two-step sign-in` : "Create Felicia's owner account (scripts/create-admin.mts) and scan the authenticator code");

      // Everything shown on the public site (active, or proposed with a "being finalised" note).
      const unapproved = (await db.select().from(services).where(inArray(services.status, ["active", "proposed"]))).filter((s) => s.priceMinor > 0 && !s.ownerApprovedPrice);
      add("Content", "Prices approved", unapproved.length === 0 ? "pass" : gap, unapproved.length === 0 ? "All active prices approved by Felicia" : `${unapproved.length} price(s) not yet approved: ${unapproved.map((s) => s.name).join(", ")}`);
    } catch (err) {
      add("Database", "Connection", "fail", `Could not query the database: ${(err as Error).message}`);
    }
  } else add("Database", "Connection", "fail", "No database connection");

  if (input.legalPages) {
    const open = Object.entries(input.legalPages).filter(([, text]) => text.includes("[CONFIRM]")).map(([name]) => name);
    add("Content", "Legal pages reviewed", open.length === 0 ? "pass" : gap, open.length === 0 ? "No open [CONFIRM] markers" : `Still marked [CONFIRM] for solicitor review: ${open.join(", ")}`);
  }

  /* ---------- Live, read-only verification ---------- */
  const v = input.verifiers;
  if (v) {
    const verify = async (area: string, fn: (() => Promise<unknown>) | undefined, describe: (r: never) => [Result, string]) => {
      if (!fn) return;
      try {
        const [result, detail] = describe((await fn()) as never);
        add(area, "Live check", result, detail);
      } catch (err) {
        add(area, "Live check", "fail", (err as Error).message);
      }
    };
    await verify("Payments", v.stripe, (r: { mode: string; webhook: string; target: string }) =>
      r.webhook === "enabled" ? ["pass", `Stripe ${r.mode} mode responds; webhook enabled at ${r.target}`] : ["fail", `Stripe responds, but no enabled webhook points at ${r.target}`],
    );
    await verify("Email", v.email, (r: { domain: string; status: string }) =>
      r.status === "verified" ? ["pass", `Sending domain ${r.domain} is verified`] : r.status === "unknown" ? ["warn", `Key works for sending only, so domain status for ${r.domain} couldn't be read. Check it in Resend.`] : ["fail", `Sending domain ${r.domain} is '${r.status}'. Add the DNS records shown in Resend.`],
    );
    await verify("Video", v.zoom, (r: { host: string; licensed: boolean }) =>
      r.licensed ? ["pass", `Zoom connected; host ${r.host} is on a paid plan`] : ["warn", `Zoom connected, but host ${r.host} is on a free plan: meetings stop after 40 minutes`],
    );
    await verify("Calendar", v.calendar, (r: { calendar: string; timeZone: string }) => ["pass", `Can read calendar '${r.calendar}' (${r.timeZone})`]);
    await verify("CRM", v.crm, () => ["pass", "HubSpot token can read contacts"]);
    await verify("AI", v.claude, (r: { missing: string[] }) => (r.missing.length ? ["fail", `Configured model(s) not available: ${r.missing.join(", ")}`] : ["pass", "Claude API key works and both models are available"]));
  }

  return checks;
}

export function summarise(checks: Check[]) {
  const failed = checks.filter((c) => c.result === "fail").length;
  const warned = checks.filter((c) => c.result === "warn").length;
  return { failed, warned, ready: failed === 0 };
}

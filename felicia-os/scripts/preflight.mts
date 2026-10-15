/**
 * Launch readiness check. See src/lib/launch/preflight.ts.
 *   npm run preflight                 configuration, database and content
 *   npm run preflight -- --verify     plus read-only checks against every connected service
 * Exits with code 1 if anything blocks launch.
 */
import { readFileSync, existsSync } from "node:fs";
import { createDb } from "../src/lib/db/client.ts";
import { env } from "../src/lib/config/env.ts";
import { runPreflight, summarise, type Verifiers } from "../src/lib/launch/preflight.ts";
import { StripeProvider } from "../src/lib/payments/provider.ts";
import { ResendTransport } from "../src/lib/email/send.ts";
import { ZoomProvider } from "../src/lib/video/provider.ts";
import { GoogleCalendarProvider } from "../src/lib/calendar/provider.ts";
import { HubSpotProvider } from "../src/lib/crm/provider.ts";
import { verifyClaude } from "../src/lib/ai/claude.ts";
import { seedCatalogue } from "../src/lib/services/catalogue.ts";

const e = env();
const verify = process.argv.includes("--verify");

const legalPages: Record<string, string> = {};
for (const name of ["privacy", "terms", "cancellation-policy"]) {
  const p = `src/app/(site)/${name}/page.tsx`;
  if (existsSync(p)) legalPages[name] = readFileSync(p, "utf8");
}

let verifiers: Verifiers | undefined;
if (verify) {
  verifiers = {};
  if (e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET) { const s = new StripeProvider(e.STRIPE_SECRET_KEY, e.STRIPE_WEBHOOK_SECRET); verifiers.stripe = () => s.verifyConnection(e.APP_URL); }
  if (e.EMAIL_PROVIDER_API_KEY) { const t = new ResendTransport(e.EMAIL_PROVIDER_API_KEY, e.EMAIL_FROM); verifiers.email = () => t.verifyDomain(); }
  if (e.ZOOM_ACCOUNT_ID && e.ZOOM_CLIENT_ID && e.ZOOM_CLIENT_SECRET) { const z = new ZoomProvider({ accountId: e.ZOOM_ACCOUNT_ID, clientId: e.ZOOM_CLIENT_ID, clientSecret: e.ZOOM_CLIENT_SECRET, hostUser: e.ZOOM_HOST_USER }); verifiers.zoom = () => z.verifyConnection(); }
  if (e.GOOGLE_CALENDAR_ID && e.GOOGLE_SERVICE_ACCOUNT_JSON) {
    verifiers.calendar = () => new GoogleCalendarProvider(e.GOOGLE_CALENDAR_ID!, JSON.parse(e.GOOGLE_SERVICE_ACCOUNT_JSON!)).verifyConnection();
  }
  if (e.HUBSPOT_ACCESS_TOKEN) { const h = new HubSpotProvider(e.HUBSPOT_ACCESS_TOKEN); verifiers.crm = () => h.verifyConnection(); }
  if (e.ANTHROPIC_API_KEY) verifiers.claude = () => verifyClaude();
}

let db = null;
try {
  db = await createDb();
  await seedCatalogue(db); // same idempotent step the site runs on start-up, so the price check sees every service
} catch (err) {
  console.error(`Database: ${(err as Error).message}`);
}

const checks = await runPreflight(db, { env: e, cronSecret: process.env.CRON_SECRET, legalPages, verifiers });
const icon = { pass: "PASS", warn: "WARN", fail: "FAIL" } as const;
console.log(`\nFELICIA OS launch check (${e.APP_ENV}${verify ? ", with live verification" : ""})\n`);
for (const c of checks) console.log(`${icon[c.result]}  ${c.area.padEnd(11)} ${c.item.padEnd(24)} ${c.detail}`);
const s = summarise(checks);
console.log(`\n${s.ready ? "Ready" : "Not ready"}: ${s.failed} blocking, ${s.warned} to review.${verify ? "" : " Run with --verify to test the live connections."}\n`);
process.exit(s.ready ? 0 : 1);

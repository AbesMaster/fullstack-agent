import { z } from "zod";

/**
 * Server-side environment. Every external integration is OPTIONAL: when its
 * credentials are missing the system falls back to a clearly labelled mock
 * provider and reports the integration as "not connected" — never as live.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().optional(), // postgres://… ; absent → embedded PGlite
  PGLITE_DIR: z.string().default(".data/pglite"),

  SESSION_SECRET: z.string().min(32).optional(),
  DATA_ENCRYPTION_KEY: z.string().optional(), // base64, 32 bytes, for sensitive intake records

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_FAST: z.string().default("claude-haiku-5-5"),
  ANTHROPIC_MODEL_STANDARD: z.string().default("claude-opus-5-5"),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  HUBSPOT_ACCESS_TOKEN: z.string().optional(),

  GOOGLE_CALENDAR_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),

  EMAIL_PROVIDER_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Felicia at MetaMasterMindz <hello@metamastermindz.com>"),

  // Zoom Server-to-Server OAuth app (Zoom Marketplace → Develop → Build App → Server-to-Server OAuth)
  ZOOM_ACCOUNT_ID: z.string().optional(),
  ZOOM_CLIENT_ID: z.string().optional(),
  ZOOM_CLIENT_SECRET: z.string().optional(),
  ZOOM_HOST_USER: z.string().default("me"), // the Zoom user (email or id) who hosts meetings

  JARVIS_BASE_URL: z.string().url().optional(),
  JARVIS_API_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

/** For tests only. */
export function resetEnvCache() {
  cached = undefined;
}

export type IntegrationName = "database" | "anthropic" | "stripe" | "hubspot" | "googleCalendar" | "zoom" | "email" | "jarvis";

export type IntegrationStatus = {
  name: IntegrationName;
  configured: boolean;
  mode: "live-credentials-present" | "mock";
  note: string;
};

/**
 * Reports whether credentials are PRESENT. Presence is not verification:
 * the Command Center labels these "configured", never "live and verified".
 */
export function integrationStatuses(e: Env = env()): IntegrationStatus[] {
  const s = (name: IntegrationName, configured: boolean, note: string): IntegrationStatus => ({
    name,
    configured,
    mode: configured ? "live-credentials-present" : "mock",
    note,
  });
  return [
    s("database", !!e.DATABASE_URL, e.DATABASE_URL ? "PostgreSQL via DATABASE_URL" : "Embedded PGlite (development only)"),
    s("anthropic", !!e.ANTHROPIC_API_KEY, "Claude drafting for agents"),
    s("stripe", !!(e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET), "Hosted checkout + signed webhooks"),
    s("hubspot", !!e.HUBSPOT_ACCESS_TOKEN, "CRM contacts and deals"),
    s("googleCalendar", !!(e.GOOGLE_CALENDAR_ID && e.GOOGLE_SERVICE_ACCOUNT_JSON), "Availability and appointments"),
    s("zoom", !!(e.ZOOM_ACCOUNT_ID && e.ZOOM_CLIENT_ID && e.ZOOM_CLIENT_SECRET), "Video links for online sessions and events"),
    s("email", !!e.EMAIL_PROVIDER_API_KEY, "Transactional email"),
    s("jarvis", !!(e.JARVIS_BASE_URL && e.JARVIS_API_TOKEN), "Parent-system reporting (spec not yet supplied)"),
  ];
}

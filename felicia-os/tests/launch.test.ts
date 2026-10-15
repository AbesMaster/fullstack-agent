import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { harness, type Harness } from "./helpers";
import { runPreflight, summarise } from "@/lib/launch/preflight";
import type { Env } from "@/lib/config/env";
import { publicUrl, resetEnvCache } from "@/lib/config/env";
import { createUser } from "@/lib/auth/auth";
import { updateService, listServices } from "@/lib/services/catalogue";
import { setVideoProviderForTests, videoProvider, VideoError } from "@/lib/video/provider";
import { emailTransport, setEmailTransportForTests } from "@/lib/email/send";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const KEY = Buffer.alloc(32, 7).toString("base64");
const prodEnv = (over: Partial<Env> = {}): Env =>
  ({
    NODE_ENV: "production",
    APP_ENV: "production",
    APP_URL: "https://metamastermindz.com",
    DATABASE_URL: "postgres://example.invalid/felicia",
    PGLITE_DIR: ".data/x",
    SESSION_SECRET: "s".repeat(48),
    DATA_ENCRYPTION_KEY: KEY,
    STRIPE_SECRET_KEY: "sk_live_example",
    STRIPE_WEBHOOK_SECRET: "whsec_example",
    EMAIL_PROVIDER_API_KEY: "re_example",
    EMAIL_FROM: "Felicia <hello@metamastermindz.com>",
    ZOOM_ACCOUNT_ID: "a",
    ZOOM_CLIENT_ID: "b",
    ZOOM_CLIENT_SECRET: "c",
    ZOOM_HOST_USER: "me",
    ANTHROPIC_MODEL_FAST: "claude-haiku-5-5",
    ANTHROPIC_MODEL_STANDARD: "claude-opus-5-5",
    ...over,
  }) as Env;

const find = (checks: Awaited<ReturnType<typeof runPreflight>>, area: string, item: string) => checks.find((c) => c.area === area && c.item === item);

describe("launch check (preflight)", () => {
  it("blocks production on missing secrets, test payment keys and unapproved content", async () => {
    const checks = await runPreflight(h.db, { env: prodEnv({ STRIPE_SECRET_KEY: "sk_test_example", SESSION_SECRET: undefined }), legalPages: { terms: "Notice period [CONFIRM]" } });
    expect(find(checks, "Payments", "Stripe")!.result).toBe("fail");
    expect(find(checks, "Payments", "Stripe")!.detail).toMatch(/TEST key/);
    expect(find(checks, "Security", "Session secret")!.result).toBe("fail");
    expect(find(checks, "Automation", "Scheduler secret")!.result).toBe("fail");
    expect(find(checks, "Accounts", "Owner sign-in")!.result).toBe("fail");
    expect(find(checks, "Content", "Prices approved")!.result).toBe("fail");
    expect(find(checks, "Content", "Legal pages reviewed")!.detail).toContain("terms");
    expect(summarise(checks).ready).toBe(false);
  });

  it("the site can live on any domain, but emails must come from that domain", async () => {
    const sub = await runPreflight(h.db, { env: prodEnv({ APP_URL: "https://felicia.metamastermindz.com", EMAIL_FROM: "Felicia <hello@metamastermindz.com>" }) });
    expect(find(sub, "Email", "Sending address")!.result).toBe("pass");
    const own = await runPreflight(h.db, { env: prodEnv({ APP_URL: "https://www.feliciastefan.com", EMAIL_FROM: "Felicia <hello@feliciastefan.com>" }) });
    expect(find(own, "Email", "Sending address")!.result).toBe("pass");
    const mismatch = await runPreflight(h.db, { env: prodEnv({ APP_URL: "https://feliciastefan.com", EMAIL_FROM: "Felicia <hello@metamastermindz.com>" }) });
    expect(find(mismatch, "Email", "Sending address")!.result).toBe("fail");
  });

  it("refuses live payment keys outside production", async () => {
    const checks = await runPreflight(h.db, { env: prodEnv({ APP_ENV: "staging" }) });
    expect(find(checks, "Payments", "Stripe")!.detail).toMatch(/LIVE key/);
  });

  it("passes when everything is set, approved and every live check succeeds", async () => {
    await createUser(h.db, { email: "owner@example.test", name: "Owner (fictional)", role: "owner", password: "a-long-test-password" });
    for (const s of await listServices(h.db)) await updateService(h.db, s.id, { status: "active" }, "user:owner"); // activating = Felicia approves the price
    const checks = await runPreflight(h.db, {
      env: prodEnv(),
      cronSecret: "c".repeat(32),
      legalPages: { terms: "Reviewed." },
      verifiers: {
        stripe: async () => ({ mode: "live", webhook: "enabled", target: "https://metamastermindz.com/api/webhooks/payments" }),
        email: async () => ({ domain: "metamastermindz.com", status: "verified" }),
        zoom: async () => ({ host: "felicia@example.test", licensed: true }),
      },
    });
    expect(checks.filter((c) => c.result === "fail").map((c) => `${c.area}/${c.item}`)).toEqual([]);
    expect(summarise(checks).ready).toBe(true);
    expect(checks.filter((c) => c.item === "Live check").every((c) => c.result === "pass")).toBe(true);
  });

  it("a live check that errors or finds a missing webhook is reported as blocking", async () => {
    const checks = await runPreflight(h.db, {
      env: prodEnv(),
      verifiers: {
        stripe: async () => ({ mode: "live", webhook: "missing", target: "https://metamastermindz.com/api/webhooks/payments" }),
        zoom: async () => {
          throw new Error("Zoom sign-in failed (401). Check the Zoom app credentials.");
        },
        email: async () => ({ domain: "metamastermindz.com", status: "pending" }),
      },
    });
    const live = checks.filter((c) => c.item === "Live check");
    expect(live.map((c) => [c.area, c.result])).toEqual([["Payments", "fail"], ["Email", "fail"], ["Video", "fail"]]);
  });
});

describe("production never fakes Zoom links or emails", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
    setVideoProviderForTests(undefined);
    setEmailTransportForTests(undefined);
  });

  it("without Zoom, meeting creation fails clearly instead of inventing a link", async () => {
    setVideoProviderForTests(undefined);
    Object.assign(process.env, { APP_ENV: "production", ZOOM_ACCOUNT_ID: "", ZOOM_CLIENT_ID: "", ZOOM_CLIENT_SECRET: "", SESSION_SECRET: "s".repeat(48) });
    resetEnvCache();
    await expect(videoProvider().createMeeting({ topic: "x", start: new Date(), durationMinutes: 60, timezone: "Europe/London", agenda: "x", idempotencyKey: "k" })).rejects.toBeInstanceOf(VideoError);
  });

  it("without an email provider, sending throws instead of pretending", () => {
    setEmailTransportForTests(undefined);
    Object.assign(process.env, { APP_ENV: "production", EMAIL_PROVIDER_API_KEY: "" });
    resetEnvCache();
    expect(() => emailTransport()).toThrow(/required in production/);
  });
});

describe("site address", () => {
  it("comes from APP_URL, without a trailing slash", () => {
    expect(publicUrl({ APP_URL: "https://feliciastefan.com/" } as Env)).toBe("https://feliciastefan.com");
  });
});

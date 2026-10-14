import "server-only";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDb, type DB } from "./db/client";
import { seedCatalogue } from "./services/catalogue";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, can, readSessionToken, mfaRequired, requirePermission, Forbidden, type Permission } from "./auth/auth";
import { env } from "./config/env";
import { BookingError } from "./booking/booking";
import { PermissionDenied } from "./agents/controls";

let seeded: Promise<void> | undefined;

/** Database for request handlers; seeds the (proposed) catalogue once per process. */
export async function db(): Promise<DB> {
  const d = await getDb();
  seeded ??= seedCatalogue(d);
  await seeded;
  return d;
}

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const u = await readSessionToken(token);
  if (!u) return null;
  if (mfaRequired(u.role) && !u.mfa) return null;
  return u;
}

/** For API routes: throws Forbidden (mapped to 403 by handle()). */
export async function requireUser(p: Permission) {
  return requirePermission(await currentUser(), p);
}

/** For pages: unauthenticated → sign-in page; authenticated but not permitted → overview with a notice. */
export async function requirePageUser(p: Permission) {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (!can(u.role, p)) redirect("/admin?forbidden=1");
  return u;
}

/* ---------------- Request hardening ---------------- */

/** CSRF defence for state-changing requests: Origin must match APP_URL (cookies are also SameSite=Strict). */
export async function assertSameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  const allowed = new URL(env().APP_URL).origin;
  if (origin && origin !== allowed) throw new Forbidden("cross-origin request");
}

const buckets = new Map<string, { tokens: number; at: number }>();
/** Simple per-IP token bucket. In multi-instance production, back this with Redis/Upstash. */
export async function rateLimit(key: string, perMinute = 20) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  const id = `${key}:${ip}`;
  const now = Date.now();
  const b = buckets.get(id) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(id, b);
    throw new RateLimited();
  }
  b.tokens -= 1;
  buckets.set(id, b);
}
export class RateLimited extends Error {}

/** Uniform JSON error mapping; never leaks stack traces or internals. */
export function handle(fn: () => Promise<Response>) {
  return fn().catch((err: unknown) => {
    if (err instanceof ZodError) return NextResponse.json({ error: "Please check the highlighted fields.", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
    if (err instanceof BookingError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.code === "conflict" ? 409 : 400 });
    if (err instanceof RateLimited) return NextResponse.json({ error: "Too many requests. Please wait a minute and try again." }, { status: 429 });
    if (err instanceof Forbidden || err instanceof PermissionDenied) return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    console.error("[felicia-os] unhandled error", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Something went wrong. Please try again, or email us." }, { status: 500 });
  });
}

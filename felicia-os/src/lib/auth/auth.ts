import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import { authenticator } from "otplib";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { users } from "../db/schema";
import { env } from "../config/env";
import { audit } from "../audit/audit";
import { newId, normaliseEmail } from "../util";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export type Role = "owner" | "admin" | "staff" | "viewer";
export type SessionUser = { id: string; email: string; name: string; role: Role };

/* ---------------- Passwords (scrypt) ---------------- */

export async function hashPassword(pw: string) {
  if (pw.length < 12) throw new Error("Passwords must be at least 12 characters");
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [alg, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const got = await scrypt(pw, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(expected, got);
}

/* ---------------- RBAC ---------------- */

export const PERMISSIONS = {
  "dashboard.view": ["owner", "admin", "staff", "viewer"],
  "services.edit": ["owner", "admin"],
  "approvals.decide": ["owner", "admin"],
  "emergency_stop.toggle": ["owner", "admin"],
  "knowledge.manage": ["owner", "admin", "staff"],
  "finance.view": ["owner", "admin"],
  "finance.edit": ["owner", "admin"],
  "intake.read": ["owner"],
  "content.manage": ["owner", "admin", "staff"],
  "users.manage": ["owner"],
  "events.manage": ["owner", "admin", "staff"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export const can = (role: Role, p: Permission) => (PERMISSIONS[p] as readonly Role[]).includes(role);

export class Forbidden extends Error {
  constructor(p: string) {
    super(`Forbidden: ${p}`);
  }
}
export function requirePermission(user: SessionUser | null, p: Permission): SessionUser {
  if (!user || !can(user.role, p)) throw new Forbidden(p);
  return user;
}

/* ---------------- Sessions (signed, httpOnly cookie) ---------------- */

export const SESSION_COOKIE = "fos_session";
const SESSION_HOURS = 12;

function sessionKey() {
  const s = env().SESSION_SECRET;
  if (!s) {
    if (env().APP_ENV === "production") throw new Error("SESSION_SECRET is required in production");
    return new TextEncoder().encode("dev-only-session-secret-change-me-please-32chars");
  }
  return new TextEncoder().encode(s);
}

export async function createSessionToken(u: SessionUser, mfaVerified: boolean) {
  return new SignJWT({ email: u.email, name: u.name, role: u.role, mfa: mfaVerified })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(sessionKey());
}

/** Returns the user only for fully authenticated sessions (MFA verified where enrolled/required). */
export async function readSessionToken(token: string | undefined): Promise<(SessionUser & { mfa: boolean }) | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey(), { algorithms: ["HS256"] });
    return { id: String(payload.sub), email: String(payload.email), name: String(payload.name), role: payload.role as Role, mfa: !!payload.mfa };
  } catch {
    return null;
  }
}

/** Administrators (owner/admin) MUST complete MFA before any privileged access. */
export const mfaRequired = (role: Role) => role === "owner" || role === "admin";

/* ---------------- Login flow ---------------- */

const attempts = new Map<string, { n: number; until: number }>();

export async function login(db: DB, email: string, password: string, totp?: string) {
  const key = normaliseEmail(email);
  const lock = attempts.get(key);
  if (lock && lock.until > Date.now()) return { ok: false as const, error: "Too many attempts. Try again in 15 minutes." };
  const [u] = await db.select().from(users).where(eq(users.email, key));
  const ok = !!u && (await verifyPassword(password, u.passwordHash));
  if (!ok || !u) {
    const n = (lock?.n ?? 0) + 1;
    attempts.set(key, { n, until: n >= 5 ? Date.now() + 15 * 60_000 : 0 });
    await audit(db, { actor: "public:web", action: "auth.login_failed", metadata: { email: key } });
    return { ok: false as const, error: "Email or password is incorrect." };
  }
  if (mfaRequired(u.role) || u.mfaEnabled) {
    if (!u.mfaEnabled || !u.totpSecret) return { ok: false as const, error: "MFA enrolment is required for this account. Run scripts/create-admin to enrol." };
    if (!totp || !authenticator.check(totp, u.totpSecret)) return { ok: false as const, error: "Enter the 6-digit code from your authenticator app.", needsTotp: true };
  }
  attempts.delete(key);
  await audit(db, { actor: `user:${u.id}`, action: "auth.login" });
  const su: SessionUser = { id: u.id, email: u.email, name: u.name, role: u.role };
  return { ok: true as const, user: su, token: await createSessionToken(su, true) };
}

export async function createUser(db: DB, input: { email: string; name: string; role: Role; password: string; withMfa?: boolean }) {
  const id = newId("usr");
  const totpSecret = input.withMfa || mfaRequired(input.role) ? authenticator.generateSecret() : null;
  await db.insert(users).values({ id, email: normaliseEmail(input.email), name: input.name, role: input.role, passwordHash: await hashPassword(input.password), totpSecret, mfaEnabled: !!totpSecret });
  return { id, totpSecret, otpauthUrl: totpSecret ? authenticator.keyuri(normaliseEmail(input.email), "FELICIA OS", totpSecret) : null };
}

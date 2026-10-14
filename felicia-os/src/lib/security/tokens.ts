import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";

function secret() {
  const s = env().SESSION_SECRET;
  if (!s && env().APP_ENV === "production") throw new Error("SESSION_SECRET is required in production");
  return s ?? "dev-only-session-secret-change-me-please-32chars";
}

/** Short signed token binding a purpose to a resource id (e.g. client intake link for a booking). */
export function signResourceToken(purpose: string, resourceId: string) {
  return createHmac("sha256", secret()).update(`${purpose}:${resourceId}`).digest("base64url");
}

export function verifyResourceToken(purpose: string, resourceId: string, token: string) {
  const a = Buffer.from(signResourceToken(purpose, resourceId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

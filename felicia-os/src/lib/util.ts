import { randomUUID, createHash } from "node:crypto";

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Money is always integer minor units (pence). */
export function formatMoney(minor: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}

export function formatPriceRange(min: number, max: number | null | undefined, currency = "GBP"): string {
  if (min === 0 && !max) return "Complimentary";
  return max && max !== min ? `${formatMoney(min, currency)}–${formatMoney(max, currency)}` : formatMoney(min, currency);
}

export const normaliseEmail = (e: string) => e.trim().toLowerCase();

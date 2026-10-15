import type { MetadataRoute } from "next";
import { publicUrl } from "@/lib/config/env";
import { db } from "@/lib/server";
import { publicEvents } from "@/lib/programme/events";

export const dynamic = "force-dynamic";

const PAGES = ["", "/about", "/sessions", "/couples", "/programmes", "/return-to-wonder", "/events", "/book", "/testimonials", "/faq", "/contact", "/privacy", "/terms", "/cancellation-policy"];

/** Public pages plus every open event, so new dates are found by search engines. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicUrl();
  const events = await publicEvents(await db());
  return [
    ...PAGES.map((p) => ({ url: `${base}${p}`, changeFrequency: p === "" || p === "/events" || p === "/return-to-wonder" ? ("weekly" as const) : ("monthly" as const), priority: p === "" ? 1 : 0.7 })),
    ...events.map((e) => ({ url: `${base}/events/${e.id}`, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}

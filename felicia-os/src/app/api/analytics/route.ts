import { headers } from "next/headers";
import { z } from "zod";
import { db, rateLimit } from "@/lib/server";
import { ingest } from "@/lib/analytics/analytics";
import { env } from "@/lib/config/env";

const Body = z.object({ n: z.string().max(40), u: z.string().max(2000), l: z.string().max(120).nullish(), r: z.string().max(2000).nullish() });

/** Receives cookieless page events. Always answers 204 so it reveals nothing to callers. */
export async function POST(req: Request) {
  try {
    await rateLimit("analytics", 120);
    const h = await headers();
    const parsed = Body.safeParse(JSON.parse(await req.text()));
    if (parsed.success) {
      await ingest(await db(), {
        name: parsed.data.n,
        url: parsed.data.u,
        label: parsed.data.l,
        referrer: parsed.data.r,
        userAgent: h.get("user-agent") ?? "",
        ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown",
        gpc: h.get("sec-gpc") === "1",
        siteHost: new URL(env().APP_URL).host,
      });
    }
  } catch {
    /* analytics must never break the site */
  }
  return new Response(null, { status: 204 });
}

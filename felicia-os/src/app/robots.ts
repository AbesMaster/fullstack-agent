import type { MetadataRoute } from "next";
import { env, publicUrl } from "@/lib/config/env";

export const dynamic = "force-dynamic";

/** Search engines may index the public site in production only; private areas are never indexed. */
export default function robots(): MetadataRoute.Robots {
  if (env().APP_ENV !== "production") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/login", "/portal", "/intake", "/feedback", "/unsubscribe", "/book/mock-checkout"] },
    sitemap: `${publicUrl()}/sitemap.xml`,
  };
}

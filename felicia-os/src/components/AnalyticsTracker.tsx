"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics";

/** Records page views on navigation and clicks on any element marked data-analytics="…". */
export function AnalyticsTracker() {
  const pathname = usePathname();
  useEffect(() => {
    track("pageview");
  }, [pathname]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-analytics]");
      const label = el?.getAttribute("data-analytics");
      if (label) track("cta_click", { label });
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}

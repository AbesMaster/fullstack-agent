/**
 * Browser side of FELICIA OS's own cookieless analytics. Sends a tiny beacon to
 * /api/analytics; stores nothing on the device. Honours Global Privacy Control.
 */
export function track(event: string, props: Record<string, string | number> = {}) {
  if (typeof window === "undefined") return;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.globalPrivacyControl) return;
  const label = props.label ?? props.service ?? props.event;
  const body = JSON.stringify({ n: event, u: location.href, l: label != null ? String(label) : null, r: event === "pageview" ? document.referrer || null : null });
  try {
    if (!navigator.sendBeacon?.("/api/analytics", new Blob([body], { type: "text/plain" }))) {
      void fetch("/api/analytics", { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => undefined);
    }
  } catch {
    /* never let analytics break the page */
  }
}

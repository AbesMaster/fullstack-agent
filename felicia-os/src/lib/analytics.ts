/**
 * Privacy-conscious analytics: no cookies, no personal data. Events are sent to the
 * configured provider (e.g. Plausible) if NEXT_PUBLIC_ANALYTICS_DOMAIN is set; otherwise no-op.
 */
export function track(event: string, props: Record<string, string | number> = {}) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { plausible?: (e: string, o?: { props: Record<string, string | number> }) => void };
  w.plausible?.(event, { props });
}

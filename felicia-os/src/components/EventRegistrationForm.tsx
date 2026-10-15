"use client";
import { useState } from "react";
import { useHydrated } from "@/components/useHydrated";
import { track } from "@/lib/analytics";

const money = (m: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(m / 100);

export function EventRegistrationForm({ eventId, priceMinor, includesBreathwork }: { eventId: string; priceMinor: number; includesBreathwork: boolean }) {
  const hydrated = useHydrated();
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending");
    const res = await fetch("/api/event-registrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId, name: f.get("name"), email: f.get("email"), phone: f.get("phone") || undefined, marketingConsent: f.get("consent") === "on", acceptedTerms: f.get("terms") === "on", healthAcknowledged: f.get("health") === "on" }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState("error");
      setMessage(j.error ?? "Something went wrong. Please try again.");
      return;
    }
    track("event_registration", { event: eventId });
    if (j.checkoutUrl) window.location.href = j.checkoutUrl;
    else setState("done");
  }

  if (state === "done")
    return (
      <div role="status" className="mt-4 rounded-2xl bg-sage/25 p-4">
        <p className="font-medium">You're registered.</p>
        <p className="mt-1 text-sm">Your confirmation is on its way to your inbox.</p>
      </div>
    );

  const input = "mt-1 w-full rounded-xl border border-navy-900/20 bg-ivory/50 px-4 py-3";
  return (
    <form method="post" onSubmit={submit} className="mt-5 space-y-4">
      <label className="block text-sm">Name<input id="reg-name" required name="name" autoComplete="name" maxLength={120} className={input} /></label>
      <label className="block text-sm">Email<input id="reg-email" required type="email" name="email" autoComplete="email" maxLength={254} className={input} /></label>
      <label className="block text-sm">Phone (optional)<input id="reg-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} className={input} /></label>
      {includesBreathwork && (
        <label className="flex items-start gap-3 text-sm"><input id="reg-health" required type="checkbox" name="health" className="mt-1" /><span>I've read the breathwork health note and will contact Felicia before the event if it applies to me.</span></label>
      )}
      <label className="flex items-start gap-3 text-sm"><input id="reg-terms" required type="checkbox" name="terms" className="mt-1" /><span>I agree to the <a href="/terms" className="underline">terms</a> and <a href="/cancellation-policy" className="underline">cancellation policy</a>, and understand this is not medical treatment.</span></label>
      <label className="flex items-start gap-3 text-sm"><input id="reg-consent" type="checkbox" name="consent" className="mt-1" /><span>Send me occasional updates about future events (optional).</span></label>
      {state === "error" && <p role="alert" className="text-sm text-red-700">{message}</p>}
      <button disabled={!hydrated || state === "sending"} className="w-full rounded-full bg-navy-900 px-6 py-3 text-ivory disabled:opacity-50">
        {state === "sending" ? "Booking…" : priceMinor === 0 ? "Reserve my place" : `Continue to secure payment (${money(priceMinor)})`}
      </button>
      {priceMinor > 0 && <p className="text-xs text-navy-800/60">Your place is held for 30 minutes while you pay. Payment is handled by our payment provider's secure checkout.</p>}
    </form>
  );
}

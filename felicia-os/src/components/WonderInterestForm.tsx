"use client";
import { useState } from "react";
import { useHydrated } from "@/components/useHydrated";
import { track } from "@/lib/analytics";

const DEFAULT_MESSAGE = "I'd like to hear when Return to Wonder dates are announced.";

/** Register interest in Return to Wonder. Creates an ordinary enquiry tagged with the experience. */
export function WonderInterestForm() {
  const hydrated = useHydrated();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("website")) return; // honeypot
    setState("sending");
    const note = String(f.get("message") ?? "").trim();
    const res = await fetch("/api/enquiries", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({
        name: f.get("name"),
        email: f.get("email"),
        message: note ? `Return to Wonder interest: ${note}` : DEFAULT_MESSAGE,
        interestServiceId: "return-to-wonder",
        marketingConsent: f.get("consent") === "on",
        sourceDetail: "return-to-wonder page",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    if (res.ok) {
      setState("sent");
      track("enquiry_submitted", { label: "return-to-wonder" });
    } else {
      setState("error");
      setError((await res.json().catch(() => ({}))).error ?? "Something went wrong. Please try again.");
    }
  }

  if (state === "sent")
    return (
      <div role="status" className="rounded-3xl bg-white/10 p-8 text-center ring-1 ring-gold/30">
        <p className="font-display text-3xl text-gold-soft">Thank you</p>
        <p className="mt-3 text-ivory/80">You're on the list for Return to Wonder. Felicia will be in touch personally, and a confirmation is on its way to your inbox.</p>
      </div>
    );

  const input = "mt-1 w-full rounded-xl border border-ivory/20 bg-navy-950/40 px-4 py-3 text-ivory placeholder:text-ivory/40 focus:border-gold focus:outline-none";
  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5 rounded-3xl bg-white/5 p-6 ring-1 ring-gold/20 md:p-8">
      <div className="hidden" aria-hidden="true">
        <label>Website <input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <label className="block text-sm text-ivory/90">Your name<input id="rtw-name" required name="name" autoComplete="name" maxLength={120} className={input} /></label>
        <label className="block text-sm text-ivory/90">Email<input id="rtw-email" required type="email" name="email" autoComplete="email" maxLength={254} className={input} /></label>
      </div>
      <label className="block text-sm text-ivory/90">What draws you to Return to Wonder? (optional)
        <textarea id="rtw-message" name="message" rows={3} maxLength={2000} className={input} placeholder="A season of change, a wish to slow down, a place you'd love to go…" />
      </label>
      <p className="text-xs text-ivory/50">Please don't share detailed health information here. If anything is relevant, Felicia will ask privately and securely before you join.</p>
      <label className="flex items-start gap-3 text-sm text-ivory/90">
        <input id="rtw-consent" type="checkbox" name="consent" className="mt-1 accent-gold" />
        <span>Also email me when new dates and experiences are announced. (Optional. Without this, Felicia simply replies to you once. Unsubscribe any time.)</span>
      </label>
      {state === "error" && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <button disabled={!hydrated || state === "sending"} className="w-full rounded-full bg-gold px-6 py-3 font-medium text-navy-950 transition hover:bg-gold-soft disabled:opacity-60">
        {state === "sending" ? "Sending…" : "Register my interest"}
      </button>
      <p className="text-xs text-ivory/50">By sending this form you agree to our <a className="underline" href="/privacy">privacy policy</a>.</p>
    </form>
  );
}

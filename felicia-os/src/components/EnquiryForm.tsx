"use client";
import { useHydrated } from "@/components/useHydrated";
import { useState } from "react";
import { track } from "@/lib/analytics";

export function EnquiryForm({ services, defaultInterest }: { services: { id: string; name: string }[]; defaultInterest?: string }) {
  const hydrated = useHydrated();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("website")) return; // honeypot
    setState("sending");
    const res = await fetch("/api/enquiries", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({
        name: f.get("name"),
        email: f.get("email"),
        phone: f.get("phone") || undefined,
        message: f.get("message"),
        interestServiceId: f.get("interest") || undefined,
        marketingConsent: f.get("consent") === "on",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    if (res.ok) {
      setState("sent");
      track("enquiry_submitted");
    } else {
      setState("error");
      setError((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
    }
  }

  if (state === "sent")
    return (
      <div role="status" className="text-center">
        <h2 className="text-3xl">Thank you</h2>
        <p className="mt-3 text-navy-800/80">Your message has arrived. You'll hear back within two working days — a confirmation is on its way to your inbox.</p>
      </div>
    );

  const input = "mt-1 w-full rounded-xl border border-navy-900/20 bg-ivory/50 px-4 py-3 focus:border-gold";
  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5" noValidate={false}>
      <div className="hidden" aria-hidden="true">
        <label>Website <input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <label className="block text-sm">Your name<input required name="name" autoComplete="name" maxLength={120} className={input} /></label>
        <label className="block text-sm">Email<input required type="email" name="email" autoComplete="email" maxLength={254} className={input} /></label>
      </div>
      <label className="block text-sm">Phone (optional)<input name="phone" type="tel" autoComplete="tel" maxLength={40} className={input} /></label>
      <label className="block text-sm">I'm interested in
        <select name="interest" defaultValue={defaultInterest ?? ""} className={input}>
          <option value="">Not sure yet</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="block text-sm">Your message<textarea required name="message" rows={5} maxLength={5000} className={input} /></label>
      <p className="text-xs text-navy-800/60">Please don't include detailed health information here — if it's relevant, Felicia will ask for it privately and securely.</p>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="consent" className="mt-1" />
        <span>I'd like to receive occasional emails about new experiences and events. (Optional — unsubscribe any time.)</span>
      </label>
      {state === "error" && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button disabled={!hydrated || state === "sending"} className="w-full rounded-full bg-navy-900 px-6 py-3 text-ivory transition hover:bg-navy-700 disabled:opacity-60">
        {state === "sending" ? "Sending…" : "Send message"}
      </button>
      <p className="text-xs text-navy-800/60">By sending this form you agree to our <a className="underline" href="/privacy">privacy policy</a>.</p>
    </form>
  );
}

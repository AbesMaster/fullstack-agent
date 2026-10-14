"use client";
import { useHydrated } from "@/components/useHydrated";
import { useState } from "react";

export function FeedbackForm({ bookingId, token }: { bookingId: string; token: string }) {
  const hydrated = useHydrated();
  const [done, setDone] = useState(false);
  const [consent, setConsent] = useState(false);
  if (done) return <p role="status">Thank you for taking the time to share this.</p>;
  const input = "mt-1 w-full rounded-xl border border-navy-900/20 px-4 py-3";
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const r = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId, token, rating: f.get("rating") ? Number(f.get("rating")) : undefined, comment: f.get("comment") || undefined, consentToPublish: consent, publishName: f.get("publishName") || undefined }) });
        setDone(r.ok);
      }}
    >
      <p className="text-sm text-navy-800/70">Completely optional. Your words stay private unless you tick the box below.</p>
      <fieldset><legend className="text-sm">How was your experience? (optional)</legend>
        <div className="mt-2 flex gap-4">{[1, 2, 3, 4, 5].map((n) => <label key={n} className="flex items-center gap-1 text-sm"><input type="radio" name="rating" value={n} /> {n}</label>)}</div>
      </fieldset>
      <label className="block text-sm">Anything you'd like to share?<textarea name="comment" rows={5} maxLength={3000} className={input} /></label>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" /><span>I'm happy for my words to be published on the website as a testimonial.</span></label>
      {consent && <label className="block text-sm">How should we credit you? (e.g. "Sarah, London" — or leave blank for anonymous)<input name="publishName" maxLength={80} className={input} /></label>}
      <button disabled={!hydrated} className="w-full rounded-full bg-navy-900 px-6 py-3 text-ivory">Send</button>
    </form>
  );
}

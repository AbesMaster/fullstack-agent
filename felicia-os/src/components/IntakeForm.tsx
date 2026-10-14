"use client";
import { useHydrated } from "@/components/useHydrated";
import { useState } from "react";

const SCREEN = [
  ["pregnant", "Are you pregnant or could you be?"],
  ["cardiovascular", "Do you have a heart condition, high blood pressure, or a history of stroke?"],
  ["epilepsyOrSeizures", "Do you have epilepsy or a history of seizures?"],
  ["respiratory", "Do you have asthma or another respiratory condition?"],
  ["recentSurgery", "Have you had surgery or a significant injury in the last six months?"],
  ["severeMentalHealth", "Are you currently experiencing, or receiving treatment for, a serious mental health condition?"],
] as const;

export function IntakeForm({ bookingId, token, serviceName, breathwork }: { bookingId: string; token: string; serviceName: string; breathwork: boolean }) {
  const hydrated = useHydrated();
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending");
    const body = {
      bookingId,
      token,
      intentions: f.get("intentions") || undefined,
      emergencyContact: f.get("emergencyContact") || undefined,
      breathwork: breathwork ? { ...Object.fromEntries(SCREEN.map(([k]) => [k, f.get(k) === "yes"])), other: f.get("other") || undefined } : undefined,
      consents: { understandsNotMedical: f.get("c1") === "on", agreesToTerms: f.get("c2") === "on", mayStopAnyTime: f.get("c3") === "on" },
    };
    const res = await fetch("/api/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      setState("done");
      setMsg(j.requiresReview ? "Thank you. Felicia will look over your answers personally before your session and may be in touch to adapt the practice." : "Thank you — you're all set.");
    } else {
      setState("error");
      setMsg(j.error ?? "Please check the form.");
    }
  }
  if (state === "done") return <p role="status" className="text-lg">{msg}</p>;
  const input = "mt-1 w-full rounded-xl border border-navy-900/20 bg-ivory/50 px-4 py-3";
  return (
    <form method="post" onSubmit={submit} className="space-y-6">
      <p className="text-sm text-navy-800/70">For: <strong>{serviceName}</strong></p>
      <label className="block text-sm">What would you like from your session? (optional)<textarea name="intentions" rows={4} maxLength={3000} className={input} /></label>
      <label className="block text-sm">Emergency contact name and number (optional, in-person sessions)<input name="emergencyContact" maxLength={200} className={input} /></label>
      {breathwork && (
        <fieldset className="space-y-4 rounded-2xl border border-navy-900/10 p-5">
          <legend className="px-2 text-sm font-semibold">Breathwork safety questions</legend>
          <p className="text-sm text-navy-800/70">Answering "yes" doesn't rule you out — it helps Felicia adapt the session safely.</p>
          {SCREEN.map(([k, q]) => (
            <div key={k} className="text-sm">
              <p>{q}</p>
              <div className="mt-1 flex gap-6">
                <label className="flex items-center gap-2"><input type="radio" name={k} value="no" required /> No</label>
                <label className="flex items-center gap-2"><input type="radio" name={k} value="yes" /> Yes</label>
              </div>
            </div>
          ))}
          <label className="block text-sm">Anything else Felicia should know? (optional)<textarea name="other" rows={3} maxLength={1000} className={input} /></label>
        </fieldset>
      )}
      <fieldset className="space-y-3 text-sm">
        <legend className="font-semibold">Consent</legend>
        <label className="flex items-start gap-3"><input required type="checkbox" name="c1" className="mt-1" /><span>I understand these sessions support wellbeing and personal development and are not medical or psychological treatment.</span></label>
        <label className="flex items-start gap-3"><input required type="checkbox" name="c2" className="mt-1" /><span>I agree to the terms and privacy policy, and consent to my answers above being stored securely for my sessions.</span></label>
        <label className="flex items-start gap-3"><input required type="checkbox" name="c3" className="mt-1" /><span>I know I can pause or stop any practice at any time.</span></label>
      </fieldset>
      {state === "error" && <p role="alert" className="text-sm text-red-700">{msg}</p>}
      <button disabled={!hydrated || state === "sending"} className="w-full rounded-full bg-navy-900 px-6 py-3 text-ivory disabled:opacity-50">{state === "sending" ? "Sending…" : "Submit securely"}</button>
    </form>
  );
}

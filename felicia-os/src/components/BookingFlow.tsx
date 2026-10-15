"use client";
import { useEffect, useMemo, useState } from "react";
import { track } from "@/lib/analytics";

type Svc = { id: string; name: string; priceMinor: number; durationMinutes: number; requiresDiscoveryCall: boolean; capacity: number; approved: boolean; deliveryMode: "online" | "in_person" | "hybrid" };

const money = (m: number) => (m === 0 ? "Complimentary" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(m / 100));

export function BookingFlow({ services, initialService }: { services: Svc[]; initialService: string }) {
  const [serviceId, setServiceId] = useState(initialService);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "submitting" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [mode, setMode] = useState<"online" | "in_person">("online");
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const svc = services.find((s) => s.id === serviceId)!;

  useEffect(() => {
    setSlots(null);
    setSlot(null);
    setState("loading");
    fetch(`/api/availability?service=${encodeURIComponent(serviceId)}`)
      .then((r) => r.json())
      .then((j) => {
        setSlots(j.slots ?? []);
        setState("idle");
      })
      .catch(() => setState("error"));
  }, [serviceId]);

  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots ?? []) {
      const d = new Date(s).toLocaleDateString("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
      m.set(d, [...(m.get(d) ?? []), s]);
    }
    return [...m.entries()];
  }, [slots, tz]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!slot) return;
    const f = new FormData(e.currentTarget);
    setState("submitting");
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ serviceId, startsAt: slot, name: f.get("name"), email: f.get("email"), phone: f.get("phone") || undefined, clientTimezone: tz, marketingConsent: f.get("consent") === "on", acceptedTerms: f.get("terms") === "on", attendanceMode: svc.deliveryMode === "hybrid" ? mode : undefined }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState("error");
      setMessage(j.error ?? "Something went wrong.");
      if (res.status === 409) {
        setKey(crypto.randomUUID());
        setSlot(null);
        fetch(`/api/availability?service=${serviceId}`).then((r) => r.json()).then((x) => setSlots(x.slots ?? []));
      }
      return;
    }
    track("booking_requested", { service: serviceId });
    if (j.checkoutUrl) window.location.href = j.checkoutUrl;
    else {
      setState("done");
      track("booking_confirmed", { service: serviceId });
    }
  }

  if (state === "done")
    return (
      <div role="status" className="mx-auto max-w-xl rounded-3xl bg-white p-8 text-center">
        <h2 className="text-3xl">You're booked</h2>
        <p className="mt-3 text-navy-800/80">A confirmation is on its way to your inbox with everything you need.</p>
      </div>
    );

  const input = "mt-1 w-full rounded-xl border border-navy-900/20 bg-ivory/50 px-4 py-3";
  return (
    <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <label className="block text-sm font-medium">Experience
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={input}>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name} — {money(s.priceMinor)}</option>)}
          </select>
        </label>
        {svc.deliveryMode === "hybrid" ? (
          <fieldset className="rounded-xl bg-white p-4">
            <legend className="px-1 text-sm font-medium">How would you like to meet?</legend>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input id="mode-online" type="radio" name="attendanceMode" checked={mode === "online"} onChange={() => setMode("online")} /> Online (Zoom link sent by email)</label>
              <label className="flex items-center gap-2"><input id="mode-in-person" type="radio" name="attendanceMode" checked={mode === "in_person"} onChange={() => setMode("in_person")} /> In person (UK)</label>
            </div>
          </fieldset>
        ) : (
          <p className="text-sm text-navy-800/70">{svc.deliveryMode === "online" ? "Online by Zoom. Your link arrives with your confirmation." : "In person. Felicia will email you the venue details."}</p>
        )}
        {svc.requiresDiscoveryCall && <p className="rounded-xl bg-lavender/15 p-4 text-sm">This experience begins with a complimentary discovery call. If you haven't had one yet, please book that first.</p>}
        {!svc.approved && svc.priceMinor > 0 && <p className="text-xs text-earth">Pricing is being finalised; the price shown at checkout is what you'll pay.</p>}
        <fieldset>
          <legend className="text-sm font-medium">Available times <span className="font-normal text-navy-800/60">(shown in your time zone: {tz})</span></legend>
          {state === "loading" && <p className="mt-3 text-sm">Loading availability…</p>}
          {slots && slots.length === 0 && <p className="mt-3 text-sm">No times are open in the next three weeks. Please <a className="underline" href="/contact">get in touch</a>.</p>}
          <div className="mt-3 max-h-[28rem] space-y-5 overflow-y-auto pr-2">
            {byDay.map(([day, times]) => (
              <div key={day}>
                <p className="text-sm font-semibold text-navy-900">{day}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {times.map((t) => (
                    <button type="button" key={t} aria-pressed={slot === t} onClick={() => setSlot(t)} className={`rounded-full border px-4 py-2 text-sm ${slot === t ? "border-navy-900 bg-navy-900 text-ivory" : "border-navy-900/20 bg-white hover:border-gold"}`}>
                      {new Date(t).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" })}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
      </div>
      <form method="post" onSubmit={submit} className="space-y-4 rounded-3xl bg-white p-6 lg:col-span-2">
        <h2 className="text-2xl">Your details</h2>
        <label className="block text-sm">Name<input required name="name" autoComplete="name" className={input} /></label>
        <label className="block text-sm">Email<input required type="email" name="email" autoComplete="email" className={input} /></label>
        <label className="block text-sm">Phone (optional)<input name="phone" type="tel" autoComplete="tel" className={input} /></label>
        <label className="flex items-start gap-3 text-sm"><input required type="checkbox" name="terms" className="mt-1" /><span>I agree to the <a href="/terms" className="underline">terms</a> and <a href="/cancellation-policy" className="underline">cancellation policy</a>, and understand sessions are not medical treatment.</span></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="consent" className="mt-1" /><span>Send me occasional updates (optional).</span></label>
        {state === "error" && <p role="alert" className="text-sm text-red-700">{message}</p>}
        <button disabled={!slot || state === "submitting"} className="w-full rounded-full bg-navy-900 px-6 py-3 text-ivory disabled:opacity-50">
          {state === "submitting" ? "Booking…" : svc.priceMinor === 0 ? "Confirm booking" : `Continue to secure payment (${money(svc.priceMinor)})`}
        </button>
        {svc.priceMinor > 0 && <p className="text-xs text-navy-800/60">Payment is handled by our payment provider's secure checkout. We never see your card details.</p>}
      </form>
    </div>
  );
}

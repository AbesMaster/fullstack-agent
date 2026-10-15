"use client";
import { useState } from "react";
import Link from "next/link";

type Session = { id: string; service: string; startsAt: string; timezone: string; status: string; upcoming: boolean; attendanceMode: string; joinUrl: string | null; passcode: string | null; welcomeFormDone: boolean; welcomeFormUrl: string | null };
type EventPlace = { id: string; eventId: string; title: string; startsAt: string; location: string; status: string; upcoming: boolean; joinUrl: string | null; passcode: string | null };
type Payment = { id: string; amountMinor: number; refundedMinor: number; currency: string; paidAt: string | null; status: string; for: string };
type Data = { name: string; email: string; marketingConsent: boolean; upcoming: Session[]; past: Session[]; events: EventPlace[]; payments: Payment[] };

const when = (iso: string, tz = "Europe/London") => new Date(iso).toLocaleString("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const money = (m: number, c = "GBP") => new Intl.NumberFormat("en-GB", { style: "currency", currency: c }).format(m / 100);
const STATUS: Record<string, string> = { completed: "Completed", no_show: "Missed", cancelled: "Cancelled", confirmed: "Confirmed", attended: "Attended", refunded: "Refunded", partially_refunded: "Partly refunded", succeeded: "Paid" };

function ChangeRequest({ bookingId }: { bookingId: string }) {
  const [kind, setKind] = useState<"reschedule" | "cancel" | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState("");
  if (done) return <p role="status" className="text-sm text-navy-800/80">{done}</p>;
  if (!kind)
    return (
      <div className="flex flex-wrap gap-2 text-sm">
        <button type="button" onClick={() => setKind("reschedule")} className="rounded-full border border-navy-900/30 px-4 py-1.5">Ask to reschedule</button>
        <button type="button" onClick={() => setKind("cancel")} className="rounded-full border border-navy-900/30 px-4 py-1.5">Ask to cancel</button>
      </div>
    );
  return (
    <div className="space-y-2 text-sm">
      <label htmlFor={`note-${bookingId}`} className="block">{kind === "cancel" ? "Anything Felicia should know? (optional)" : "Which days or times would suit you better?"}</label>
      <textarea id={`note-${bookingId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} className="w-full rounded-xl border border-navy-900/20 px-3 py-2" />
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-full bg-navy-900 px-4 py-1.5 text-ivory"
          onClick={async () => {
            const r = await fetch("/api/portal/change", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId, kind, message: note }) });
            setDone(r.ok ? "Thank you. Felicia will reply personally, usually within two working days. Your booking stays as it is until then." : "Sorry, that didn't send. Please reply to your confirmation email instead.");
          }}
        >
          Send request
        </button>
        <button type="button" onClick={() => setKind(null)} className="text-navy-800/70 underline">Back</button>
      </div>
      {kind === "cancel" && <p className="text-xs text-navy-800/60">Refunds follow our <Link href="/cancellation-policy" className="underline">cancellation policy</Link>.</p>}
    </div>
  );
}

function JoinBox({ url, passcode }: { url: string; passcode: string | null }) {
  return (
    <div className="rounded-xl bg-lavender/15 p-3 text-sm">
      <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium underline">Join on Zoom</a>
      {passcode && <span className="ml-3 text-navy-800/70">Passcode: <span className="font-mono">{passcode}</span></span>}
      <p className="mt-1 text-xs text-navy-800/60">You'll wait briefly until Felicia lets you in. Sessions are never recorded.</p>
    </div>
  );
}

export function PortalDashboard({ data }: { data: Data }) {
  const [marketing, setMarketing] = useState(data.marketingConsent);
  const [prefMsg, setPrefMsg] = useState("");
  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <section aria-labelledby="upcoming-h" className="space-y-4">
        <h2 id="upcoming-h" className="text-3xl">Coming up</h2>
        {data.upcoming.length === 0 && data.events.filter((e) => e.upcoming).length === 0 ? (
          <p className="rounded-2xl bg-white p-6 text-navy-800/80">Nothing booked at the moment. <Link href="/book?service=discovery-call" className="underline">Book a session</Link> or <Link href="/events" className="underline">see upcoming events</Link>.</p>
        ) : null}
        {data.upcoming.map((s) => (
          <article key={s.id} className="space-y-3 rounded-2xl bg-white p-6">
            <div>
              <h3 className="text-2xl">{s.service}</h3>
              <p className="text-sm text-navy-800/70">{when(s.startsAt, s.timezone)} · {s.attendanceMode === "in_person" ? "In person" : "Online"}</p>
            </div>
            {s.joinUrl && <JoinBox url={s.joinUrl} passcode={s.passcode} />}
            {s.attendanceMode === "in_person" && <p className="text-sm text-navy-800/70">Felicia will email you the venue details before the day.</p>}
            {s.welcomeFormUrl && <p className="text-sm"><Link href={s.welcomeFormUrl} className="font-medium underline">Complete your welcome &amp; consent form</Link> <span className="text-navy-800/60">(helps Felicia prepare)</span></p>}
            {s.welcomeFormDone && <p className="text-sm text-navy-800/60">Welcome form received. Thank you.</p>}
            <ChangeRequest bookingId={s.id} />
          </article>
        ))}
        {data.events.filter((e) => e.upcoming).map((e) => (
          <article key={e.id} className="space-y-3 rounded-2xl bg-white p-6">
            <div>
              <h3 className="text-2xl">{e.title}</h3>
              <p className="text-sm text-navy-800/70">{when(e.startsAt)} · {e.location}</p>
            </div>
            {e.joinUrl && <JoinBox url={e.joinUrl} passcode={e.passcode} />}
            <p className="text-sm"><Link href={`/events/${e.eventId}`} className="underline">Event details</Link></p>
          </article>
        ))}
      </section>

      {(data.past.length > 0 || data.events.some((e) => !e.upcoming)) && (
        <section aria-labelledby="past-h" className="space-y-3">
          <h2 id="past-h" className="text-3xl">Past and cancelled</h2>
          <ul className="divide-y divide-navy-900/10 rounded-2xl bg-white">
            {data.past.map((s) => <li key={s.id} className="flex flex-wrap justify-between gap-2 p-4 text-sm"><span>{s.service} · {when(s.startsAt, s.timezone)}</span><span className="text-navy-800/70">{STATUS[s.status] ?? s.status}</span></li>)}
            {data.events.filter((e) => !e.upcoming).map((e) => <li key={e.id} className="flex flex-wrap justify-between gap-2 p-4 text-sm"><span>{e.title} · {when(e.startsAt)}</span><span className="text-navy-800/70">{STATUS[e.status] ?? e.status}</span></li>)}
          </ul>
        </section>
      )}

      {data.payments.length > 0 && (
        <section aria-labelledby="pay-h" className="space-y-3">
          <h2 id="pay-h" className="text-3xl">Payments</h2>
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-navy-800/60"><tr><th className="p-3">Date</th><th className="p-3">For</th><th className="p-3 text-right">Amount</th><th className="p-3">Status</th></tr></thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id} className="border-t border-navy-900/5">
                    <td className="p-3 whitespace-nowrap">{p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-GB") : "—"}</td>
                    <td className="p-3">{p.for}</td>
                    <td className="p-3 text-right tabular-nums">{money(p.amountMinor, p.currency)}{p.refundedMinor > 0 && <span className="block text-xs text-navy-800/60">{money(p.refundedMinor, p.currency)} refunded</span>}</td>
                    <td className="p-3">{STATUS[p.status] ?? p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-navy-800/60">Your full receipt was emailed by our payment provider when you paid.</p>
        </section>
      )}

      <section aria-labelledby="pref-h" className="space-y-3">
        <h2 id="pref-h" className="text-3xl">Email preferences</h2>
        <div className="rounded-2xl bg-white p-6 text-sm">
          <label className="flex items-start gap-3">
            <input
              id="pref-marketing"
              type="checkbox"
              checked={marketing}
              onChange={async (e) => {
                const next = e.target.checked;
                setMarketing(next); // respond straight away; undo if saving fails
                const r = await fetch("/api/portal/preferences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ marketing: next }) }).catch(() => null);
                if (r?.ok) setPrefMsg(next ? "You'll receive occasional updates." : "You won't receive updates. Booking emails still arrive as normal.");
                else {
                  setMarketing(!next);
                  setPrefMsg("That didn't save. Please try again.");
                }
              }}
              className="mt-1"
            />
            <span>Send me occasional news about new experiences and events (never more than twice a month).</span>
          </label>
          {prefMsg && <p role="status" className="mt-2 text-navy-800/70">{prefMsg}</p>}
          <p className="mt-3 text-xs text-navy-800/60">Signed in as {data.email}. Your welcome form answers are kept private and aren't shown here.</p>
        </div>
      </section>

      <form method="post" action="/api/portal/sign-out"><button className="text-sm underline">Sign out</button></form>
    </div>
  );
}

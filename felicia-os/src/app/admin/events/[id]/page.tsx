import Link from "next/link";
import { notFound } from "next/navigation";
import { db, requirePageUser } from "@/lib/server";
import { eventRoster, getEvent } from "@/lib/programme/events";
import { Card } from "@/components/admin/Stat";
import { EventEditor, CancelRegistrationButton, ChecklistEditor } from "@/components/admin/EventEditor";
import { AttendanceButtons } from "@/components/admin/AttendanceButtons";
import { formatInZone, toZonedInputValue } from "@/lib/booking/time";
import { formatMoney } from "@/lib/util";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser("events.manage");
  const d = await db();
  const ev = await getEvent(d, (await params).id);
  if (!ev) notFound();
  const roster = await eventRoster(d, ev.id);
  const active = roster.filter(({ r }) => r.status !== "cancelled");
  return (
    <div className="space-y-6">
      <Link href="/admin/events" className="text-sm underline">← All events</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-navy-800/60">{formatInZone(ev.startsAt, "Europe/London")} · {ev.location}</p>
          <h1 className="text-4xl">{ev.title}</h1>
        </div>
        {["open", "full", "closed", "completed"].includes(ev.status) && <Link href={`/events/${ev.id}`} className="text-sm underline">View public page</Link>}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Details">
            <EventEditor
              mode="edit"
              initial={{ id: ev.id, title: ev.title, description: ev.description, location: ev.location, startsAt: toZonedInputValue(ev.startsAt), endsAt: toZonedInputValue(ev.endsAt), capacity: ev.capacity, priceMinor: ev.priceMinor, budgetMinor: ev.budgetMinor, includesBreathwork: ev.includesBreathwork, isOnline: ev.isOnline, status: ev.status }}
            />
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Readiness checklist"><ChecklistEditor id={ev.id} items={ev.checklist} /></Card>
          {ev.isOnline && (
            <Card title="Zoom">
              {ev.videoJoinUrl ? (
                <div className="space-y-2 text-sm">
                  <p>Attendees receive this link in their confirmation and reminder emails:</p>
                  <p className="break-all rounded-lg bg-ivory p-2 font-mono text-xs">{ev.videoJoinUrl}</p>
                  {ev.videoPasscode && <p>Passcode: <span className="font-mono">{ev.videoPasscode}</span></p>}
                  <p className="text-xs text-navy-800/60">Start the meeting from your own Zoom app. The waiting room is on and meetings are never recorded.</p>
                </div>
              ) : (
                <p className="text-sm text-navy-800/70">The meeting is created automatically when the first person registers.</p>
              )}
            </Card>
          )}
        </div>
      </div>
      <Card title={`Registrations (${active.length} active)`}>
        {roster.length === 0 ? <p className="text-sm text-navy-800/60">Nobody has registered yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-navy-800/60"><tr><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2">Status</th><th className="p-2 text-right">Amount</th><th className="p-2">Registered</th><th className="p-2" /></tr></thead>
              <tbody>
                {roster.map(({ r, c }) => (
                  <tr key={r.id} className="border-t border-navy-900/5">
                    <td className="p-2">{c.name}</td>
                    <td className="p-2">{c.email}</td>
                    <td className="p-2">{ev.startsAt < new Date() && ["confirmed", "attended", "no_show"].includes(r.status) ? <AttendanceButtons kind="registration" id={r.id} status={r.status} /> : r.status === "pending_payment" ? "awaiting payment" : r.status}</td>
                    <td className="p-2 text-right tabular-nums">{r.amountMinor === 0 ? "Free" : formatMoney(r.amountMinor)}</td>
                    <td className="p-2 whitespace-nowrap">{r.createdAt.toLocaleDateString("en-GB")}</td>
                    <td className="p-2 text-right">{(r.status === "confirmed" || r.status === "pending_payment") && <CancelRegistrationButton id={r.id} paid={r.status === "confirmed" && r.amountMinor > 0} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

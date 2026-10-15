import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, requirePageUser } from "@/lib/server";
import { programmeEvents } from "@/lib/db/schema";
import { eventRoster, eventTypes } from "@/lib/programme/events";
import { eventProfitability } from "@/lib/finance/finance";
import { Card } from "@/components/admin/Stat";
import { EventEditor } from "@/components/admin/EventEditor";
import { formatInZone } from "@/lib/booking/time";
import { formatMoney } from "@/lib/util";

const STATUS_STYLE: Record<string, string> = { planning: "bg-lavender/30", open: "bg-sage/40", full: "bg-gold/40", closed: "bg-ivory", completed: "bg-ivory", cancelled: "bg-red-100" };

export default async function Page() {
  await requirePageUser("events.manage");
  const d = await db();
  const events = await d.select().from(programmeEvents).orderBy(desc(programmeEvents.startsAt));
  const money = new Map((await eventProfitability(d)).map((p) => [p.eventId, p]));
  const counts = new Map(
    await Promise.all(
      events.map(async (e) => {
        const roster = await eventRoster(d, e.id);
        return [e.id, { confirmed: roster.filter(({ r }) => r.status === "confirmed" || r.status === "attended").length, pending: roster.filter(({ r }) => r.status === "pending_payment").length }] as const;
      }),
    ),
  );
  return (
    <div className="space-y-6">
      <h1 className="text-4xl">Events & workshops</h1>
      <p className="text-sm text-navy-800/70">Create an event as <strong>Planning</strong> (hidden), then set it to <strong>Open</strong> to publish it and start taking registrations. It switches to <strong>Full</strong> by itself when the places are taken.</p>
      <Card title="New event"><EventEditor mode="create" types={await eventTypes(d)} /></Card>
      <Card title={`All events (${events.length})`}>
        {events.length === 0 ? <p className="text-sm text-navy-800/60">No events yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-navy-800/60"><tr><th className="p-2">When</th><th className="p-2">Event</th><th className="p-2">Status</th><th className="p-2 text-right">Places</th><th className="p-2 text-right">Price</th><th className="p-2 text-right">Paid revenue</th><th className="p-2 text-right">Costs / budget</th></tr></thead>
              <tbody>
                {events.map((e) => {
                  const c = counts.get(e.id)!;
                  const m = money.get(e.id);
                  return (
                    <tr key={e.id} className="border-t border-navy-900/5">
                      <td className="p-2 whitespace-nowrap">{formatInZone(e.startsAt, "Europe/London")}</td>
                      <td className="p-2"><Link className="font-medium underline" href={`/admin/events/${e.id}`}>{e.title}</Link><br /><span className="text-xs text-navy-800/60">{e.location}</span></td>
                      <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[e.status] ?? ""}`}>{e.status}</span></td>
                      <td className="p-2 text-right tabular-nums">{c.confirmed}/{e.capacity}{c.pending ? <span className="block text-xs text-navy-800/60">+{c.pending} awaiting payment</span> : null}</td>
                      <td className="p-2 text-right tabular-nums">{e.priceMinor === 0 ? "Free" : formatMoney(e.priceMinor)}</td>
                      <td className="p-2 text-right tabular-nums">{formatMoney(m?.paidRevenueMinor ?? 0)}</td>
                      <td className="p-2 text-right tabular-nums">{formatMoney(m?.costMinor ?? 0)} / {formatMoney(e.budgetMinor)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

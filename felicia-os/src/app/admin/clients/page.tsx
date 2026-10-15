import { desc, eq } from "drizzle-orm";
import { db, requirePageUser } from "@/lib/server";
import { bookings, contacts, enquiries, intakeRecords, services } from "@/lib/db/schema";
import { Card } from "@/components/admin/Stat";
import { formatInZone } from "@/lib/booking/time";
import { formatMoney } from "@/lib/util";
import { IntakeViewer } from "@/components/admin/IntakeViewer";
import { AttendanceButtons } from "@/components/admin/AttendanceButtons";

export default async function Page() {
  const user = await requirePageUser("dashboard.view");
  const d = await db();
  const enq = await d.select({ e: enquiries, c: contacts }).from(enquiries).innerJoin(contacts, eq(enquiries.contactId, contacts.id)).orderBy(desc(enquiries.createdAt)).limit(50);
  const bks = await d.select({ b: bookings, c: contacts, s: services }).from(bookings).innerJoin(contacts, eq(bookings.contactId, contacts.id)).innerJoin(services, eq(bookings.serviceId, services.id)).orderBy(desc(bookings.startsAt)).limit(50);
  const intakes = await d.select({ id: intakeRecords.id, bookingId: intakeRecords.bookingId, requiresReview: intakeRecords.requiresReview }).from(intakeRecords);
  const intakeFor = new Map(intakes.map((i) => [i.bookingId, i]));
  return (
    <div className="space-y-6">
      <h1 className="text-4xl">Enquiries & bookings</h1>
      <Card title="Enquiries">
        <ul className="divide-y divide-navy-900/10 text-sm">
          {enq.map(({ e, c }) => (
            <li key={e.id} className="py-3">
              <p><strong>{c.name}</strong> &lt;{c.email}&gt; · {e.channel} · intent <strong>{e.bookingIntent}</strong> · <span className={e.status === "escalated" ? "text-red-700" : ""}>{e.status}</span>{e.escalationReason ? ` (${e.escalationReason})` : ""} · marketing consent: {c.marketingConsent ? "yes" : "no"}</p>
              <p className="mt-1 whitespace-pre-wrap text-navy-800/80">{e.message}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Bookings">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-navy-800/60"><tr><th className="p-2">When (London)</th><th className="p-2">Client</th><th className="p-2">Service</th><th className="p-2">Status</th><th className="p-2">Amount</th><th className="p-2">Welcome form</th></tr></thead>
            <tbody>
              {bks.map(({ b, c, s }) => {
                const i = intakeFor.get(b.id);
                return (
                  <tr key={b.id} className="border-t border-navy-900/5">
                    <td className="p-2 whitespace-nowrap">{formatInZone(b.startsAt, "Europe/London")}</td><td className="p-2">{c.name}</td><td className="p-2">{s.name}<br /><span className="text-xs text-navy-800/60">{b.attendanceMode === "in_person" ? "In person" : b.videoJoinUrl ? "Online · Zoom link sent" : "Online"}</span></td><td className="p-2">{b.startsAt < new Date() && ["confirmed", "completed", "no_show"].includes(b.status) ? <AttendanceButtons kind="booking" id={b.id} status={b.status} /> : b.status}</td><td className="p-2">{formatMoney(b.amountMinor)}</td>
                    <td className="p-2">{i ? <>{i.requiresReview ? <span className="text-red-700">review needed</span> : "received"}{user.role === "owner" && <IntakeViewer id={i.id} />}</> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, Section } from "@/components/ui";
import { ServiceCard } from "@/components/ServiceCard";
import { db } from "@/lib/server";
import { listServices } from "@/lib/services/catalogue";
import { publicEvents } from "@/lib/programme/events";
import { formatInZone } from "@/lib/booking/time";
import { formatMoney } from "@/lib/util";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Events & Workshops", description: "Online groups, half-day workshops and healing adventures." };

export default async function Page() {
  const d = await db();
  const upcoming = await publicEvents(d);
  const formats = (await listServices(d, { publicOnly: true })).filter((s) => s.category === "Groups & workshops" || s.id === "return-to-wonder");
  return (
    <>
      <PageHero eyebrow="Gather" title="Events & Workshops"><p>Learn, breathe and reflect in good company, online and in person.</p></PageHero>
      <Section>
        <h2 className="text-3xl">Upcoming dates</h2>
        {upcoming.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-white p-6 text-navy-800/80">No dates are published yet. <Link className="underline" href="/contact?interest=half-day-workshop">Register your interest</Link> and we'll let you know when places open.</p>
        ) : (
          <ul className="mt-6 grid gap-4 md:grid-cols-2">
            {upcoming.map((e) => (
              <li key={e.id} className="flex flex-col rounded-2xl bg-white p-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-lavender-deep">{formatInZone(e.startsAt, "Europe/London")}</p>
                <h3 className="mt-2 text-2xl">{e.title}</h3>
                <p className="mt-1 text-sm text-navy-800/70">{e.location}</p>
                <div className="mt-4 flex flex-1 items-end justify-between gap-4">
                  <div>
                    <p className="font-display text-2xl">{e.priceMinor === 0 ? "Free" : formatMoney(e.priceMinor)}</p>
                    <p className="text-sm text-navy-800/70">{e.seatsLeft === 0 ? "Fully booked" : e.seatsLeft <= 3 ? `${e.seatsLeft} place${e.seatsLeft === 1 ? "" : "s"} left` : "Places available"}</p>
                  </div>
                  <Link href={`/events/${e.id}`} className="rounded-full bg-navy-900 px-5 py-2.5 text-sm text-ivory hover:bg-navy-700" data-analytics="cta_event_details">
                    {e.seatsLeft === 0 ? "Details" : "Details & booking"}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        <h2 className="mt-16 text-3xl">Formats</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">{formats.map((s) => <ServiceCard key={s.id} s={s} />)}</div>
      </Section>
    </>
  );
}

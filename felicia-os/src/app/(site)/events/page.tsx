import type { Metadata } from "next";
import { asc, gte } from "drizzle-orm";
import { PageHero, Section, CtaButton } from "@/components/ui";
import { ServiceCard } from "@/components/ServiceCard";
import { db } from "@/lib/server";
import { listServices } from "@/lib/services/catalogue";
import { programmeEvents } from "@/lib/db/schema";
import { formatInZone } from "@/lib/booking/time";
import { formatMoney } from "@/lib/util";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Events & Workshops", description: "Online groups, half-day workshops and healing adventures." };

export default async function Page() {
  const d = await db();
  const upcoming = (await d.select().from(programmeEvents).where(gte(programmeEvents.startsAt, new Date())).orderBy(asc(programmeEvents.startsAt))).filter((e) => e.status === "open" || e.status === "full");
  const formats = (await listServices(d, { publicOnly: true })).filter((s) => s.category === "Groups & workshops");
  return (
    <>
      <PageHero eyebrow="Gather" title="Events & Workshops"><p>Learn, breathe and reflect in good company — online and in person.</p></PageHero>
      <Section>
        <h2 className="text-3xl">Upcoming dates</h2>
        {upcoming.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-white p-6 text-navy-800/80">No dates are published yet. <a className="underline" href="/contact?interest=events">Register your interest</a> and you'll hear first (only if you opt in to updates).</p>
        ) : (
          <ul className="mt-6 grid gap-4 md:grid-cols-2">
            {upcoming.map((e) => (
              <li key={e.id} className="rounded-2xl bg-white p-6">
                <h3 className="text-2xl">{e.title}</h3>
                <p className="mt-1 text-sm text-navy-800/70">{formatInZone(e.startsAt, "Europe/London")} · {e.location}</p>
                <p className="mt-2 font-display text-xl">{formatMoney(e.priceMinor)}</p>
                <p className="text-sm">{e.status === "full" ? "This event is full." : "Places available"}</p>
                {e.status === "open" && <div className="mt-4"><CtaButton href={`/contact?interest=event:${e.id}`} variant="navy">Ask about a place</CtaButton></div>}
              </li>
            ))}
          </ul>
        )}
        <h2 className="mt-16 text-3xl">Formats</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-2">{formats.map((s) => <ServiceCard key={s.id} s={s} />)}</div>
      </Section>
    </>
  );
}

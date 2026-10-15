import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHero, Section, Disclaimer, CtaButton } from "@/components/ui";
import { EventRegistrationForm } from "@/components/EventRegistrationForm";
import { db } from "@/lib/server";
import { getEvent, seatsTaken } from "@/lib/programme/events";
import { formatInZone } from "@/lib/booking/time";
import { formatMoney } from "@/lib/util";
import { SITE } from "@/lib/site";
import { publicUrl } from "@/lib/config/env";

export const dynamic = "force-dynamic";

async function load(id: string) {
  const d = await db();
  const ev = await getEvent(d, id);
  // Draft (planning) and cancelled events are never shown publicly.
  if (!ev || !["open", "full", "closed", "completed"].includes(ev.status)) return null;
  return { ev, seatsLeft: Math.max(0, ev.capacity - (await seatsTaken(d, ev.id))) };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const data = await load((await params).id);
  return data ? { title: data.ev.title, description: data.ev.description.slice(0, 160) || `${data.ev.title} with Felicia Stefan` } : { title: "Event not found" };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ registered?: string; cancelled?: string }> }) {
  const data = await load((await params).id);
  if (!data) notFound();
  const { ev, seatsLeft } = data;
  const { registered, cancelled } = await searchParams;
  const upcoming = ev.startsAt > new Date();
  const canRegister = upcoming && ev.status === "open" && seatsLeft > 0;
  const hours = Math.round(((ev.endsAt.getTime() - ev.startsAt.getTime()) / 3600_000) * 10) / 10;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: ev.title,
    startDate: ev.startsAt.toISOString(),
    endDate: ev.endsAt.toISOString(),
    eventStatus: "https://schema.org/EventScheduled",
    location: ev.isOnline ? { "@type": "VirtualLocation", url: `${publicUrl()}/events/${ev.id}` } : { "@type": "Place", name: ev.location },
    eventAttendanceMode: ev.isOnline ? "https://schema.org/OnlineEventAttendanceMode" : "https://schema.org/OfflineEventAttendanceMode",
    organizer: { "@type": "Organization", name: SITE.name, url: publicUrl() },
    offers: { "@type": "Offer", price: (ev.priceMinor / 100).toFixed(2), priceCurrency: "GBP", availability: seatsLeft > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut" },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PageHero eyebrow={ev.serviceId === "return-to-wonder" ? `Return to Wonder · ${formatInZone(ev.startsAt, "Europe/London")}` : formatInZone(ev.startsAt, "Europe/London")} title={ev.title}>
        <p>{ev.location}</p>
        {ev.serviceId === "return-to-wonder" && <p className="mt-3 text-sm"><Link className="text-gold-soft underline" href="/return-to-wonder">About Return to Wonder</Link></p>}
      </PageHero>
      <Section>
        {registered && <p role="status" className="mx-auto mb-8 max-w-3xl rounded-xl bg-sage/25 p-4">Thank you. Your payment is being confirmed and your place details will arrive by email shortly.</p>}
        {cancelled && <p role="status" className="mx-auto mb-8 max-w-3xl rounded-xl bg-gold/15 p-4 text-sm">Checkout was cancelled and no payment was taken. Your place is held for 30 minutes if you'd like to try again.</p>}
        <div className="grid gap-10 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            <dl className="grid gap-4 rounded-3xl bg-white p-6 sm:grid-cols-3">
              <div><dt className="text-xs uppercase tracking-wider text-navy-800/60">When</dt><dd className="mt-1 text-sm">{formatInZone(ev.startsAt, "Europe/London")}<br /><span className="text-navy-800/70">{hours} hours</span></dd></div>
              <div><dt className="text-xs uppercase tracking-wider text-navy-800/60">Where</dt><dd className="mt-1 text-sm">{ev.location}</dd>{ev.isOnline && <dd className="text-xs text-navy-800/60">Online via Zoom. Your link arrives with your confirmation.</dd>}</div>
              <div><dt className="text-xs uppercase tracking-wider text-navy-800/60">Investment</dt><dd className="mt-1 font-display text-2xl">{ev.priceMinor === 0 ? "Free" : formatMoney(ev.priceMinor)}</dd><dd className="text-xs text-navy-800/60">per person</dd></div>
            </dl>
            {ev.description ? <div className="whitespace-pre-line leading-relaxed text-navy-800">{ev.description}</div> : <p className="text-navy-800/70">Full details for this event will be shared soon.</p>}
            {ev.includesBreathwork && <Disclaimer>This event includes breathwork, which isn't suitable for everyone. If you are pregnant, or have a heart, respiratory, seizure-related or serious mental health condition, please contact us before booking so Felicia can advise you.</Disclaimer>}
            <Disclaimer>{SITE.wellbeingDisclaimer}</Disclaimer>
          </div>
          <aside className="lg:col-span-2">
            <div className="rounded-3xl bg-white p-6 lg:sticky lg:top-24">
              {canRegister ? (
                <>
                  <h2 className="text-2xl">Book your place</h2>
                  <p className="mt-1 text-sm text-navy-800/70">{seatsLeft <= 3 ? `${seatsLeft} place${seatsLeft === 1 ? "" : "s"} left` : `${ev.capacity} places in total`}</p>
                  <EventRegistrationForm eventId={ev.id} priceMinor={ev.priceMinor} includesBreathwork={ev.includesBreathwork} />
                </>
              ) : (
                <div className="space-y-4">
                  <h2 className="text-2xl">{!upcoming || ev.status === "completed" ? "This event has taken place" : ev.status === "closed" ? "Booking has closed" : "Fully booked"}</h2>
                  <p className="text-sm text-navy-800/80">{upcoming ? "Get in touch and we'll let you know if a place opens up or a new date is announced." : "See what's coming up next."}</p>
                  <CtaButton href={upcoming ? "/contact?interest=half-day-workshop" : "/events"} variant="navy">{upcoming ? "Ask about a place" : "Upcoming events"}</CtaButton>
                </div>
              )}
            </div>
          </aside>
        </div>
      </Section>
    </>
  );
}

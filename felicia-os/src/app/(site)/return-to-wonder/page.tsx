import type { Metadata } from "next";
import Link from "next/link";
import { CtaButton, Disclaimer, MissingAsset, Section } from "@/components/ui";
import { WonderFilm } from "@/components/WonderFilm";
import { WonderInterestForm } from "@/components/WonderInterestForm";
import { db } from "@/lib/server";
import { getService } from "@/lib/services/catalogue";
import { publicEvents } from "@/lib/programme/events";
import { formatInZone } from "@/lib/booking/time";
import { formatMoney, formatPriceRange } from "@/lib/util";
import { SITE } from "@/lib/site";
import { publicUrl } from "@/lib/config/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Return to Wonder",
  description: "Felicia Stefan's signature small-group healing adventure: time in nature, guided breath and genuine connection. Explore the Earth. Open the Heart. Remember Who You Are.",
};

const MOVEMENTS = [
  {
    n: "I",
    title: "Explore the Earth",
    text: "Step outside your routine and into a place chosen for its beauty and stillness. Time outdoors, walking and simply noticing helps the mind settle and the senses wake up.",
  },
  {
    n: "II",
    title: "Open the Heart",
    text: "Guided breathwork, Star Magic-inspired practices and gentle emotional awareness create space to feel what has been waiting to be felt, at your own pace and always by choice.",
  },
  {
    n: "III",
    title: "Remember Who You Are",
    text: "Quiet reflection, sharing in a small circle and simple practices to take home help you carry what you discovered back into everyday life.",
  },
];

const elements = (groupSize: number) => [
  ["Time in nature", "Unhurried time outdoors, matched to the location and the group."],
  ["Guided breath", "Breathwork led by Felicia, with clear health guidance beforehand and the freedom to pause at any moment."],
  ["Star Magic-inspired practice", "Gentle, energy-focused practices drawn from Felicia's own path."],
  ["Reflection and integration", "Journaling, quiet time and sharing, so the experience doesn't end when you go home."],
  ["A small circle", `Groups are kept small (up to ${groupSize} people) so everyone is seen and heard.`],
  ["Clear details up front", "Each date lists the venue, what's included, the physical requirements and what to bring before you register."],
];

const STEPS = [
  ["Choose a date or register interest", "Book a place on a published date, or join the interest list to hear first when new dates are announced."],
  ["Talk it through (optional)", "Not sure it's right for you? A free discovery call with Felicia is the easiest way to find out."],
  ["Prepare", "You'll receive joining details and what to bring. Experiences that include breathwork share a health notice for you to read and confirm when you register."],
  ["Arrive and take part", "Everything is an invitation, never a requirement. You choose how deeply to take part."],
  ["Carry it home", "Leave with simple practices and reflections to keep the sense of wonder alive."],
];

const FAQ = [
  ["Do I need any experience?", "No. Return to Wonder is designed for people new to breathwork and reflective practice as well as those who have done this kind of work before."],
  ["How fit do I need to be?", "It depends on the location. Each date lists its physical requirements and accessibility in advance. If you're unsure, ask before registering and we'll talk it through honestly."],
  ["Can I come on my own?", "Yes. Many people come on their own, and the small group is there to make that feel welcoming."],
  ["Is breathwork safe for me?", "Breathwork isn't suitable for everyone, for example during pregnancy or with some heart, respiratory or seizure conditions. Experiences that include it show a health notice you confirm when registering. If any of it applies to you, talk to Felicia first, and you can always sit a practice out."],
  ["What does it cost?", "Each date shows its own price, which depends on the location and what's included. Refund terms depend on venue and supplier commitments and are confirmed when you register."],
  ["Is this therapy?", "No. Return to Wonder supports personal growth and wellbeing. It isn't a substitute for medical or psychological care, and no particular outcome is promised."],
];

export default async function Page() {
  const d = await db();
  const service = await getService(d, "return-to-wonder");
  const dates = await publicEvents(d, new Date(), { serviceId: "return-to-wonder" });
  const groupSize = service?.capacity ?? 12;

  const jsonLd = dates.map((e) => ({
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.title,
    startDate: e.startsAt.toISOString(),
    endDate: e.endsAt.toISOString(),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: e.isOnline ? "https://schema.org/OnlineEventAttendanceMode" : "https://schema.org/OfflineEventAttendanceMode",
    location: e.isOnline ? { "@type": "VirtualLocation", url: `${publicUrl()}/events/${e.id}` } : { "@type": "Place", name: e.location, address: e.location },
    organizer: { "@type": "Person", name: SITE.owner, url: publicUrl() },
    offers: { "@type": "Offer", price: (e.priceMinor / 100).toFixed(2), priceCurrency: "GBP", availability: e.seatsLeft > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut", url: `${publicUrl()}/events/${e.id}` },
  }));

  return (
    <>
      {jsonLd.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}

      {/* Hero */}
      <section className="starfield relative overflow-hidden text-ivory">
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 top-1/2 h-[42rem] w-[42rem] -translate-y-1/2 rounded-full bg-gold/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-12 md:py-28">
          <div className="md:col-span-7">
            <p className="animate-fade-up text-xs font-semibold uppercase tracking-[0.35em] text-gold">Felicia's signature experience</p>
            <h1 className="animate-fade-up mt-5 text-5xl uppercase leading-[1.05] tracking-wide md:text-7xl">Return to Wonder</h1>
            <p className="animate-fade-up mt-6 font-display text-2xl italic text-gold-soft md:text-3xl">{SITE.philosophy}</p>
            <p className="animate-fade-up mt-6 max-w-xl text-lg text-ivory/80">
              A small-group healing adventure: time in nature, guided breath and genuine connection with people on the same path. A chance to step out of everyday life and remember the part of you that still feels wonder.
            </p>
            <div className="animate-fade-up mt-10 flex flex-col gap-3 sm:flex-row">
              <CtaButton href="#dates" analytics="cta_rtw_dates">See upcoming dates</CtaButton>
              <CtaButton href="#interest" variant="outline" analytics="cta_rtw_interest">Register your interest</CtaButton>
            </div>
          </div>
          <div className="md:col-span-5">
            <div className="animate-fade-up mx-auto aspect-[9/16] max-h-[70vh] max-w-xs overflow-hidden rounded-[2rem] shadow-2xl shadow-black/50 ring-1 ring-gold/30 md:max-w-sm">
              <WonderFilm sources={[{ src: "/media/return-to-wonder-film.webm", type: "video/webm" }, { src: "/media/return-to-wonder-film.mp4", type: "video/mp4" }]} poster="/media/return-to-wonder-poster.jpg" label="Return to Wonder film: Felicia walking towards a glowing golden portal and a Star Magic star" />
            </div>
          </div>
        </div>
      </section>

      {/* Three movements */}
      <Section>
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-lavender-deep">The journey</p>
          <h2 className="mt-2 text-4xl text-navy-900 md:text-5xl">Three movements</h2>
          <p className="mt-4 text-navy-800/80">Every Return to Wonder is shaped around its location and its group, but each one follows the same arc.</p>
        </div>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {MOVEMENTS.map((m) => (
            <li key={m.n} className="relative overflow-hidden rounded-3xl bg-navy-950 p-8 text-ivory shadow-sm">
              <span aria-hidden="true" className="absolute right-6 top-2 font-display text-7xl leading-none text-gold/15">{m.n}</span>
              <p className="text-xs font-semibold uppercase tracking-widest text-gold">Movement {m.n}</p>
              <h3 className="mt-3 text-3xl">{m.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ivory/75">{m.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* What it includes */}
      <Section tone="lavender">
        <div className="grid gap-12 md:grid-cols-5">
          <div className="md:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-lavender-deep">What to expect</p>
            <h2 className="mt-2 text-4xl text-navy-900">What an experience can include</h2>
            <p className="mt-4 text-navy-800/80">The exact programme is published with each date. These are the threads woven through every one.</p>
            <MissingAsset label="Landscape photography from a Return to Wonder location" className="mt-8 aspect-[4/3]" />
          </div>
          <dl className="grid gap-4 sm:grid-cols-2 md:col-span-3">
            {elements(groupSize).map(([t, x]) => (
              <div key={t} className="rounded-2xl bg-white p-6 shadow-sm">
                <dt className="flex items-center gap-2 text-lg text-navy-900"><span aria-hidden="true" className="text-gold">✦</span>{t}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-navy-800/75">{x}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      {/* Dates */}
      <Section>
        <div id="dates" className="scroll-mt-24">
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-lavender-deep">Join us</p>
              <h2 className="mt-2 text-4xl text-navy-900">Upcoming dates</h2>
            </div>
            {service && service.priceMinor > 0 && (
              <p className="text-sm text-navy-800/70">
                Typically {formatPriceRange(service.priceMinor, service.priceMaxMinor, service.currency)} per person, depending on location and inclusions.
                {!service.ownerApprovedPrice && <span className="block text-xs text-earth">Pricing is being finalised.</span>}
              </p>
            )}
          </div>
          {dates.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-lavender-deep/40 bg-white p-8 text-center">
              <p className="font-display text-2xl text-navy-900">The next Return to Wonder is being planned</p>
              <p className="mx-auto mt-3 max-w-xl text-navy-800/75">Dates and locations are announced once venues are confirmed. Register your interest below and you'll be among the first to hear.</p>
              <div className="mt-6"><CtaButton href="#interest" variant="navy" analytics="cta_rtw_empty_interest">Register your interest</CtaButton></div>
            </div>
          ) : (
            <ul className="mt-8 grid gap-6 md:grid-cols-2">
              {dates.map((e) => (
                <li key={e.id} className="flex flex-col overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-navy-900/5">
                  <div className="starfield px-7 py-5 text-ivory">
                    <p className="text-xs font-semibold uppercase tracking-widest text-gold">{formatInZone(e.startsAt, "Europe/London")}</p>
                    <h3 className="mt-1 text-2xl">{e.title}</h3>
                  </div>
                  <div className="flex flex-1 flex-col p-7">
                    <p className="text-sm text-navy-800/70">{e.location}</p>
                    {e.description && <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-navy-800/80">{e.description}</p>}
                    <div className="mt-6 flex flex-1 items-end justify-between gap-4">
                      <div>
                        <p className="font-display text-2xl">{e.priceMinor === 0 ? "Free" : formatMoney(e.priceMinor)}<span className="font-sans text-sm text-navy-800/60"> per person</span></p>
                        <p className="text-sm text-navy-800/70">{e.seatsLeft === 0 ? "Fully booked" : e.seatsLeft <= 3 ? `${e.seatsLeft} place${e.seatsLeft === 1 ? "" : "s"} left` : "Places available"}</p>
                      </div>
                      <Link href={`/events/${e.id}`} className="rounded-full bg-navy-900 px-5 py-2.5 text-sm text-ivory hover:bg-navy-700" data-analytics="cta_rtw_event">
                        {e.seatsLeft === 0 ? "Details" : "Details & booking"}
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {/* How it works */}
      <Section tone="white">
        <div className="mx-auto max-w-3xl">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-lavender-deep">How it works</p>
          <h2 className="mt-2 text-center text-4xl text-navy-900">From first step to coming home</h2>
          <ol className="mt-10 space-y-6">
            {STEPS.map(([t, x], i) => (
              <li key={t} className="flex gap-5">
                <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-950 font-display text-lg text-gold">{i + 1}</span>
                <div>
                  <h3 className="text-xl text-navy-900">{t}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-navy-800/75">{x}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-10 text-center">
            <CtaButton href="/book?service=discovery-call" variant="navy" analytics="cta_rtw_discovery">{SITE.primaryCta}</CtaButton>
          </div>
        </div>
      </Section>

      {/* FAQ */}
      <Section>
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-4xl text-navy-900">Questions</h2>
          <div className="mt-8 divide-y divide-navy-900/10 rounded-3xl bg-white px-6 shadow-sm">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg text-navy-900">
                  {q}
                  <span aria-hidden="true" className="text-gold transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-navy-800/80">{a}</p>
              </details>
            ))}
          </div>
          <div className="mt-8">
            <Disclaimer>{SITE.wellbeingDisclaimer} Outdoor activities carry their own considerations; each date lists its physical requirements in advance. See the <Link className="underline" href="/cancellation-policy">cancellation policy</Link>.</Disclaimer>
          </div>
        </div>
      </Section>

      {/* Register interest */}
      <section id="interest" className="starfield scroll-mt-16 text-ivory">
        <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 py-20 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold">Be the first to know</p>
            <h2 className="mt-3 text-4xl md:text-5xl">Register your interest</h2>
            <p className="mt-5 text-lg text-ivory/80">Places are limited to small groups. Leave your details and Felicia will let you know personally when the next Return to Wonder opens.</p>
            <p className="mt-6 font-display text-2xl italic text-gold-soft">{SITE.philosophy}</p>
          </div>
          <WonderInterestForm />
        </div>
      </section>
    </>
  );
}

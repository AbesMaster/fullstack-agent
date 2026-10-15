import Image from "next/image";
import { SITE } from "@/lib/site";
import goldenHaloPortrait from "@/assets/felicia/golden-halo-portrait.jpg";
import { CtaButton, MissingAsset, Section } from "@/components/ui";
import { ServiceCard } from "@/components/ServiceCard";
import { db } from "@/lib/server";
import { listServices } from "@/lib/services/catalogue";

export const dynamic = "force-dynamic";

const PILLARS = [
  { title: "Reconnect", text: "Slow down and listen inward. Sessions create unhurried space to notice what you feel and what you need." },
  { title: "Rediscover", text: "Breathwork, emotional awareness and Star Magic-inspired practices help you meet yourself with curiosity rather than judgement." },
  { title: "Realign", text: "Leave with a clearer sense of direction and simple practices to carry into everyday life." },
];

export default async function Home() {
  const services = (await listServices(await db(), { publicOnly: true })).filter((s) => ["signature-private-session", "four-session-journey", "return-to-wonder"].includes(s.id));
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: SITE.name,
    url: SITE.url,
    founder: { "@type": "Person", name: SITE.owner },
    areaServed: ["GB", "Worldwide (online)"],
    slogan: SITE.philosophy,
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="starfield relative overflow-hidden text-ivory">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-24 md:grid-cols-5 md:py-36">
          <div className="md:col-span-3">
            <p className="animate-fade-up text-xs font-semibold uppercase tracking-[0.35em] text-gold">Felicia Stefan · MetaMasterMindz</p>
            <h1 className="animate-fade-up mt-5 text-5xl uppercase leading-[1.05] tracking-wide md:text-7xl">{SITE.heroTitle}</h1>
            <p className="animate-fade-up mt-6 max-w-xl text-lg text-ivory/80 md:text-xl">{SITE.heroSub}</p>
            <div className="animate-fade-up mt-10 flex flex-col gap-3 sm:flex-row">
              <CtaButton href="/book?service=discovery-call" analytics="cta_hero_discovery">{SITE.primaryCta}</CtaButton>
              <CtaButton href="/sessions" variant="outline" analytics="cta_hero_explore">{SITE.secondaryCta}</CtaButton>
            </div>
          </div>
          <div className="md:col-span-2">
            <Image
              src={goldenHaloPortrait}
              alt="Felicia Stefan framed by a golden halo against a starry midnight sky"
              priority
              placeholder="blur"
              sizes="(min-width: 768px) 40vw, 100vw"
              className="animate-fade-up aspect-[4/5] w-full rounded-3xl object-cover shadow-2xl shadow-black/40 ring-1 ring-gold/30"
            />
          </div>
        </div>
      </section>

      <Section>
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-display text-3xl italic text-lavender-deep md:text-4xl">“{SITE.philosophy}”</p>
          <p className="mt-6 text-navy-800/80">
            MetaMasterMindz is Felicia Stefan's space for spiritual wellness and personal development — private sessions, programmes,
            workshops and healing adventures for people ready to come home to themselves.
          </p>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p.title} className="rounded-3xl bg-white p-8 shadow-sm">
              <h2 className="text-3xl text-navy-900">{p.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-navy-800/80">{p.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="lavender">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-lavender-deep">Ways to work together</p>
            <h2 className="mt-2 text-4xl text-navy-900">Healing experiences</h2>
          </div>
          <CtaButton href="/sessions" variant="navy">See all experiences</CtaButton>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {services.map((s) => <ServiceCard key={s.id} s={s} />)}
        </div>
      </Section>

      <section className="starfield text-ivory">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 md:grid-cols-2">
          <MissingAsset label="Nature / adventure photography for Return to Wonder" className="aspect-video border-gold/40 bg-white/5 text-gold-soft" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gold">Signature experience</p>
            <h2 className="mt-2 text-5xl">Return to Wonder</h2>
            <p className="mt-4 text-ivory/80">Step outside, slow your breath and remember the part of you that still feels awe. A small-group healing adventure in nature, guided by Felicia.</p>
            <div className="mt-8"><CtaButton href="/return-to-wonder" analytics="cta_home_rtw">Discover Return to Wonder</CtaButton></div>
          </div>
        </div>
      </section>

      <Section>
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-4xl text-navy-900">Not sure where to begin?</h2>
          <p className="mt-4 text-navy-800/80">A complimentary 20-minute discovery call is a gentle, no-obligation conversation to explore what you're looking for and whether working together feels right.</p>
          <div className="mt-8"><CtaButton href="/book?service=discovery-call" variant="navy" analytics="cta_footer_discovery">{SITE.primaryCta}</CtaButton></div>
        </div>
      </Section>
    </>
  );
}

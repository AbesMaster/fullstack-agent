import type { Metadata } from "next";
import { PageHero, Section, Disclaimer, CtaButton } from "@/components/ui";
import { ServiceCard } from "@/components/ServiceCard";
import { db } from "@/lib/server";
import { listServices } from "@/lib/services/catalogue";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Couples Experiences", description: "A shared space for partners to slow down, listen to one another and reconnect with intention." };

const IDS = "couples-experience,discovery-call".split(",");

export default async function Page() {
  const services = (await listServices(await db(), { publicOnly: true })).filter((s) => IDS.includes(s.id)).sort((a, b) => IDS.indexOf(a.id) - IDS.indexOf(b.id));
  return (
    <>
      <PageHero eyebrow="Couples" title="Couples Experiences">
        <p>A shared space for partners to slow down, listen to one another and reconnect with intention.</p>
      </PageHero>
      <Section>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => <ServiceCard key={s.id} s={s} />)}
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl bg-white p-8">
            <h2 className="text-3xl">What to expect</h2>
            <ul className="mt-4 space-y-2 text-sm text-navy-800/80 [&_li]:ml-5 [&_li]:list-disc">
              <li>A short welcome and consent form before your session, so Felicia can prepare.</li>
              <li>Time to settle, set an intention and talk about what you'd like to explore.</li>
              <li>Guided practice — which may include breathwork, visualisation and gentle reflection. You can pause or stop at any time.</li>
              <li>Integration time, and simple practices to take home.</li>
            </ul>
          </div>
          <div className="space-y-4">
            <Disclaimer>{SITE.wellbeingDisclaimer}</Disclaimer>
            <Disclaimer>Breathwork isn't suitable for everyone. If you are pregnant, or have a heart, respiratory, seizure-related or serious mental health condition, Felicia will review your welcome form and may adapt or postpone the practice.</Disclaimer>
            <CtaButton href="/book?service=discovery-call" variant="navy">{SITE.primaryCta}</CtaButton>
          </div>
        </div>
      </Section>
    </>
  );
}

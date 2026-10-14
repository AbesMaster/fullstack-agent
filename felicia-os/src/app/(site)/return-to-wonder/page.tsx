import type { Metadata } from "next";
import { PageHero, Section, MissingAsset, Disclaimer, CtaButton } from "@/components/ui";
import { ServiceCard } from "@/components/ServiceCard";
import { db } from "@/lib/server";
import { getService } from "@/lib/services/catalogue";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Return to Wonder", description: "Felicia's signature healing adventure: nature, breath and connection." };

export default async function Page() {
  const s = await getService(await db(), "return-to-wonder");
  return (
    <>
      <PageHero eyebrow="Signature experience" title="Return to Wonder">
        <p>{SITE.philosophy}</p>
      </PageHero>
      <Section>
        <div className="grid gap-10 md:grid-cols-2">
          <div className="space-y-4 text-navy-800">
            <p className="text-lg">Return to Wonder is a small-group healing adventure: time outdoors, guided breath, quiet reflection and genuine connection with others on the same path.</p>
            <p>Each experience is designed around its location. Details — dates, venue, what's included, accessibility and what to bring — are published with each event.</p>
            <MissingAsset label="Upcoming Return to Wonder dates, locations and inclusions (published when venues are confirmed)" />
            <Disclaimer>{SITE.wellbeingDisclaimer} Outdoor activities carry their own considerations; each event lists its physical requirements in advance.</Disclaimer>
            <div className="flex flex-wrap gap-3">
              <CtaButton href="/events" variant="navy">See upcoming events</CtaButton>
              <CtaButton href="/contact?interest=return-to-wonder" variant="outline">Register interest</CtaButton>
            </div>
          </div>
          <div className="space-y-6">
            <MissingAsset label="Landscape photography from a Return to Wonder location" className="aspect-[4/3]" />
            {s && <ServiceCard s={s} />}
          </div>
        </div>
      </Section>
    </>
  );
}

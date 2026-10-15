import type { Metadata } from "next";
import Image from "next/image";
import { PageHero, Section, MissingAsset, CtaButton, Disclaimer } from "@/components/ui";
import { SITE } from "@/lib/site";
import starMagicPortrait from "@/assets/felicia/star-magic-portrait.jpg";

export const metadata: Metadata = { title: "About Felicia", description: "Meet Felicia Stefan, founder of MetaMasterMindz." };

export default function About() {
  return (
    <>
      <PageHero eyebrow="About" title="Meet Felicia Stefan">
        <p>{SITE.philosophy}</p>
      </PageHero>
      <Section>
        <div className="grid gap-10 md:grid-cols-5">
          <div className="md:col-span-2">
            <Image
              src={starMagicPortrait}
              alt="Felicia Stefan in front of a lavender nebula and a golden eight-point star"
              placeholder="blur"
              sizes="(min-width: 768px) 40vw, 100vw"
              className="aspect-[4/5] w-full rounded-3xl object-cover shadow-xl ring-1 ring-lavender-deep/20"
            />
          </div>
          <div className="space-y-5 text-navy-800 md:col-span-3">
            <MissingAsset label="Felicia's approved biography — her story, what led her to this work, and what she believes. (Not written by AI to avoid inventing details.)" className="min-h-48" />
            <h2 className="pt-4 text-3xl text-navy-900">Training & approach</h2>
            <MissingAsset label="Verified credentials and training (e.g. Star Magic, breathwork). Listed only once certificates are confirmed." />
            <Disclaimer>{SITE.wellbeingDisclaimer}</Disclaimer>
            <CtaButton href="/book?service=discovery-call" variant="navy">{SITE.primaryCta}</CtaButton>
          </div>
        </div>
      </Section>
    </>
  );
}

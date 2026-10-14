import type { Metadata } from "next";
import { PageHero, Section } from "@/components/ui";

export const metadata: Metadata = { title: "Testimonials", description: "Words from clients, shared with their permission." };

export default function Page() {
  return (
    <>
      <PageHero eyebrow="Kind words" title="Testimonials" />
      <Section>
        <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 text-center">
          <p className="text-lg text-navy-800">Client stories will appear here once clients have chosen to share them.</p>
          <p className="mt-4 text-sm text-navy-800/70">We only publish genuine words from real clients, with their written consent, and we never edit them in a way that changes their meaning. Individual experiences vary and are not a promise of any particular outcome.</p>
        </div>
      </Section>
    </>
  );
}

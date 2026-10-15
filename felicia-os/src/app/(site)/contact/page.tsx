import type { Metadata } from "next";
import { PageHero, Section } from "@/components/ui";
import { EnquiryForm } from "@/components/EnquiryForm";
import { db } from "@/lib/server";
import { listServices } from "@/lib/services/catalogue";
import { contactEmail } from "@/lib/config/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contact" };

export default async function Page({ searchParams }: { searchParams: Promise<{ interest?: string }> }) {
  const { interest } = await searchParams;
  const services = await listServices(await db(), { publicOnly: true });
  return (
    <>
      <PageHero eyebrow="Get in touch" title="Contact Felicia's team"><p>Questions, ideas or not sure where to start? Send a message and we'll reply within two working days.</p></PageHero>
      <Section>
        <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8">
          <EnquiryForm services={services.map((s) => ({ id: s.id, name: s.name }))} defaultInterest={interest && services.some((s) => s.id === interest) ? interest : undefined} />
        </div>
        <p className="mt-6 text-center text-sm text-navy-800/70">
          Prefer email? Write to <a className="underline" href={`mailto:${contactEmail()}`}>{contactEmail()}</a>.
        </p>
      </Section>
    </>
  );
}

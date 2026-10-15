import type { Metadata } from "next";
import { PageHero, Section } from "@/components/ui";
import { BookingFlow } from "@/components/BookingFlow";
import { db } from "@/lib/server";
import { listServices } from "@/lib/services/catalogue";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Book", description: "Book a complimentary discovery call or a session with Felicia." };

export default async function Page({ searchParams }: { searchParams: Promise<{ service?: string; cancelled?: string }> }) {
  const { service, cancelled } = await searchParams;
  const services = (await listServices(await db(), { publicOnly: true })).filter((s) => s.durationMinutes && s.capacity <= 2);
  const initial = services.find((s) => s.id === service)?.id ?? "discovery-call";
  return (
    <>
      <PageHero eyebrow="Booking" title="Choose your time" />
      <Section>
        {cancelled && <p role="status" className="mx-auto mb-6 max-w-3xl rounded-xl bg-gold/15 p-4 text-sm">Checkout was cancelled — no payment was taken. Your time is held briefly if you'd like to try again.</p>}
        <BookingFlow
          initialService={initial}
          services={services.map((s) => ({ id: s.id, name: s.name, priceMinor: s.priceMinor, durationMinutes: s.durationMinutes!, requiresDiscoveryCall: s.bookingRules.requiresDiscoveryCall, capacity: s.capacity, approved: s.ownerApprovedPrice, deliveryMode: s.deliveryMode }))}
        />
      </Section>
    </>
  );
}

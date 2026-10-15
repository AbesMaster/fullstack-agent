import type { Metadata } from "next";
import { PageHero, Section } from "@/components/ui";
import { PortalSignInForm } from "@/components/portal/PortalSignInForm";
import { PortalDashboard } from "@/components/portal/PortalDashboard";
import { currentClientId, db } from "@/lib/server";
import { portalOverview } from "@/lib/portal/portal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Client Portal", robots: { index: false } };

export default async function Page() {
  const contactId = await currentClientId();
  const overview = contactId ? await portalOverview(await db(), contactId) : null;

  if (!overview) {
    return (
      <>
        <PageHero eyebrow="Clients" title="Your client area"><p>See your sessions and places, join online sessions, and manage your emails.</p></PageHero>
        <Section>
          <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-5">
            <div className="rounded-3xl bg-white p-8 md:col-span-3">
              <h2 className="text-3xl">Sign in</h2>
              <p className="mt-2 text-sm text-navy-800/70">No password needed. Enter the email you booked with and we'll send you a secure link.</p>
              <PortalSignInForm />
            </div>
            <div className="space-y-4 text-sm text-navy-800/80 md:col-span-2">
              <p><strong>What you'll find inside:</strong> your upcoming and past sessions, Zoom links for online sessions, your event places, payments, and your email preferences.</p>
              <p>Need to change a booking? Sign in and choose "Ask to reschedule" or "Ask to cancel", or simply reply to your confirmation email.</p>
            </div>
          </div>
        </Section>
      </>
    );
  }

  return (
    <>
      <PageHero eyebrow="Your client area" title={`Welcome, ${overview.name.split(" ")[0]}`} />
      <Section>
        <PortalDashboard data={JSON.parse(JSON.stringify(overview))} />
      </Section>
    </>
  );
}

import { PageHero, Section, CtaButton } from "@/components/ui";

export const metadata = { title: "Client Portal" };

/**
 * Client portal (phase 1): secure links per booking (welcome form, reschedule via email).
 * Phase 2 (planned): passwordless magic-link sign-in showing upcoming sessions, receipts and materials.
 */
export default function Page() {
  return (
    <>
      <PageHero eyebrow="Clients" title="Client portal" />
      <Section>
        <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-3">
          {[
            ["Your welcome form", "Use the secure link in your booking confirmation email to complete your welcome & consent form."],
            ["Change a booking", "Reply to your confirmation email, or contact us — we'll help you reschedule."],
            ["Receipts", "Your payment receipt is emailed by our payment provider when you pay."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-3xl bg-white p-6">
              <h2 className="text-2xl">{t}</h2>
              <p className="mt-2 text-sm text-navy-800/80">{d}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-navy-800/70">A personal sign-in area with your upcoming sessions and post-session materials is coming soon.</p>
        <div className="mt-6 text-center"><CtaButton href="/contact" variant="navy">Contact us</CtaButton></div>
      </Section>
    </>
  );
}

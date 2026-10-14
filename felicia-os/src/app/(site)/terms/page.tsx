import type { Metadata } from "next";
import { PageHero, Section, Prose } from "@/components/ui";
import { LegalDraftBanner } from "@/components/LegalDraftBanner";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Terms & Conditions" };

export default function Page() {
  return (
    <>
      <PageHero title="Terms & conditions" />
      <Section>
        <Prose>
          <LegalDraftBanner />
          <h2>About our services</h2>
          <p>{SITE.wellbeingDisclaimer}</p>
          <p>Felicia is not presented as a medical practitioner, psychologist or psychotherapist. [CONFIRM: list verified qualifications, insurance provider and professional memberships.]</p>
          <h2>Your responsibilities</h2>
          <ul>
            <li>Complete the welcome and consent form honestly before sessions that include breathwork.</li>
            <li>Continue any treatment advised by your healthcare professionals.</li>
            <li>You may pause or stop any practice at any time.</li>
          </ul>
          <h2>Bookings and payment</h2>
          <p>Prices are shown in pounds sterling. A booking is confirmed once payment is received through our secure checkout (complimentary discovery calls are confirmed immediately). [CONFIRM VAT status.]</p>
          <h2>Consumer rights</h2>
          <p>If you book online you normally have a 14-day cancellation period under the Consumer Contracts Regulations. If you ask for a session to take place within that period, you agree that we may begin and you may lose the right to cancel once the service is fully performed. [CONFIRM wording with solicitor.]</p>
          <h2>Liability</h2>
          <p>[CONFIRM limitation-of-liability clause, aligned with professional indemnity insurance.]</p>
          <h2>Governing law</h2>
          <p>England and Wales. [CONFIRM]</p>
        </Prose>
      </Section>
    </>
  );
}

import type { Metadata } from "next";
import { PageHero, Section, Prose } from "@/components/ui";
import { LegalDraftBanner } from "@/components/LegalDraftBanner";

export const metadata: Metadata = { title: "Cancellation & Refund Policy" };

export default function Page() {
  return (
    <>
      <PageHero title="Cancellation & refund policy" />
      <Section>
        <Prose>
          <LegalDraftBanner />
          <h2>Private sessions and couples experiences</h2>
          <ul>
            <li>More than 48 hours before your session: free rescheduling or a full refund.</li>
            <li>Within 48 hours: one free reschedule; refunds at Felicia's discretion.</li>
            <li>If Felicia needs to cancel, you'll be offered a new time or a full refund.</li>
          </ul>
          <h2>Programmes</h2>
          <p>[CONFIRM] Suggested: refund of unused sessions, less any sessions already delivered at the single-session rate.</p>
          <h2>Online groups and workshops</h2>
          <p>Online groups: full refund up to 24 hours before. Workshops: full refund up to 7 days before; transfers welcome.</p>
          <h2>Return to Wonder and retreats</h2>
          <p>Terms depend on venue and supplier commitments and are confirmed when you register.</p>
          <h2>How refunds are processed</h2>
          <p>Every refund request is reviewed by a person. Approved refunds are returned to the original payment method; your bank may take 5–10 working days.</p>
          <h2>Your statutory rights</h2>
          <p>Nothing in this policy affects your rights under UK consumer law.</p>
        </Prose>
      </Section>
    </>
  );
}

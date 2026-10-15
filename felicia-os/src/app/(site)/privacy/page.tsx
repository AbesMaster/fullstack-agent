import type { Metadata } from "next";
import { PageHero, Section, Prose } from "@/components/ui";
import { LegalDraftBanner } from "@/components/LegalDraftBanner";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function Page() {
  return (
    <>
      <PageHero title="Privacy policy" />
      <Section>
        <Prose>
          <LegalDraftBanner />
          <p>This policy explains how MetaMasterMindz ("we"), the practice of Felicia Stefan, collects and uses personal data. We follow the UK GDPR and the Data Protection Act 2018.</p>
          <h2>Who we are</h2>
          <p>Data controller: [CONFIRM legal name / trading name, registered address, ICO registration number]. Contact: [CONFIRM privacy email].</p>
          <h2>What we collect and why</h2>
          <ul>
            <li><strong>Enquiries and bookings</strong> — name, email, optional phone, time zone and your message. Lawful basis: steps prior to/performance of a contract.</li>
            <li><strong>Welcome & consent form</strong> — intentions for your session and, where breathwork is involved, health screening answers. This is <em>special category data</em>; we process it only with your explicit consent so that sessions can be delivered safely. It is encrypted and accessible only to Felicia.</li>
            <li><strong>Payments</strong> — processed by our payment provider ([CONFIRM: Stripe / PayPal]). We never see or store full card details.</li>
            <li><strong>Marketing emails</strong> — only if you opt in (consent). Every email has a one-click unsubscribe. We comply with PECR.</li>
            <li><strong>Website analytics</strong> — we count visits with our own cookieless analytics. Nothing is stored on your device, and we don't keep your IP address or anything that identifies you. A visit can only be recognised for one day, using a code that's discarded every night. If your browser sends a Global Privacy Control signal, you aren't counted at all. Lawful basis: legitimate interests in understanding how the site is used. Records are deleted after 13 months.</li>
          </ul>
          <h2>AI assistance</h2>
          <p>We use AI tools to help run the business — for example, to answer routine website questions (the chat assistant always identifies itself as AI) and to draft content that a human reviews. Your health information is never shared with AI tools or our CRM.</p>
          <h2>Who we share data with</h2>
          <p>Service providers acting on our behalf: hosting, email delivery, calendar, video calls (Zoom, for online sessions: we share only the session time, never your name, email or health details; sessions are never recorded), CRM ([CONFIRM: HubSpot]), payment processing and AI providers (Anthropic) for non-sensitive drafting. Some providers may process data outside the UK under appropriate safeguards [CONFIRM transfer mechanisms].</p>
          <h2>How long we keep it</h2>
          <p>[CONFIRM retention schedule] — suggested: enquiries 24 months; client records 6 years (tax/accounting); welcome/consent forms 6 years or as advised by insurer; marketing until you unsubscribe.</p>
          <h2>Your rights</h2>
          <p>You can ask to access, correct, delete or restrict use of your data, object to processing, withdraw consent at any time, and complain to the Information Commissioner's Office (ico.org.uk).</p>
        </Prose>
      </Section>
    </>
  );
}

import type { Metadata } from "next";
import { PageHero, Section } from "@/components/ui";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Frequently Asked Questions" };

const FAQ = [
  { q: "What happens on a discovery call?", a: "It's a relaxed, complimentary 20-minute video call. You share what's bringing you here, Felicia explains how she works, and together you decide whether a session or programme feels right. There's no obligation." },
  { q: "Is this therapy or medical treatment?", a: SITE.wellbeingDisclaimer },
  { q: "What is Star Magic-inspired wellness?", a: "Felicia draws on Star Magic-inspired practices alongside breathwork and emotional awareness. She'll explain what this means in practice during your discovery call so you can decide if it suits you." },
  { q: "Is breathwork safe for me?", a: "Breathwork isn't suitable for everyone. Before any session that includes it, you'll complete a short, confidential welcome form. If you are pregnant, or have heart, respiratory, seizure-related or serious mental health conditions, Felicia will review your answers and may adapt the session. Please check with your doctor if you're unsure." },
  { q: "Online or in person?", a: "Many sessions are available online by video, so you can join from anywhere. In-person sessions and experiences are offered in the UK, with locations shared on booking." },
  { q: "How do payments work?", a: "Payments are taken securely by our payment provider's hosted checkout. We never see or store your card details." },
  { q: "What if I need to cancel?", a: "Please see our cancellation and refund policy. We'll always try to help you reschedule." },
  { q: "Is the chat assistant a real person?", a: "No. The chat assistant on this website is an AI that can answer common questions about services, pricing and booking. It always identifies itself as an AI and passes anything personal or sensitive to Felicia." },
  { q: "What do you do with my information?", a: "We collect only what we need to arrange and deliver your sessions. Anything you share about your health is encrypted and seen only by Felicia. See our privacy policy for details." },
];

export default function Page() {
  const jsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PageHero eyebrow="Questions" title="Frequently asked questions" />
      <Section>
        <div className="mx-auto max-w-3xl divide-y divide-navy-900/10 rounded-3xl bg-white">
          {FAQ.map((f) => (
            <details key={f.q} className="group p-6">
              <summary className="cursor-pointer list-none font-display text-xl text-navy-900 marker:hidden">
                <span className="mr-2 inline-block text-gold transition group-open:rotate-45">+</span>
                {f.q}
              </summary>
              <p className="mt-3 text-navy-800/80">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>
    </>
  );
}

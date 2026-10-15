import { PageHero, Section } from "@/components/ui";
import { FeedbackForm } from "@/components/FeedbackForm";
import { verifyResourceToken } from "@/lib/security/tokens";

export const metadata = { title: "Share your experience", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ b?: string; t?: string }> }) {
  const { b, t } = await searchParams;
  const ok = !!b && !!t && verifyResourceToken("feedback", b, t);
  return (
    <>
      <PageHero title="Share your experience" />
      <Section>
        <div className="mx-auto max-w-xl rounded-3xl bg-white p-8">{ok ? <FeedbackForm bookingId={b!} token={t!} /> : <p>This link is invalid or has expired.</p>}</div>
      </Section>
    </>
  );
}

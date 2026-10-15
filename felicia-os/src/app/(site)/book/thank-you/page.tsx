import { PageHero, Section } from "@/components/ui";

export default function Page() {
  return (
    <>
      <PageHero title="Thank you" />
      <Section>
        <div className="mx-auto max-w-xl rounded-3xl bg-white p-8 text-center">
          <p>Your payment is being confirmed. As soon as it is, you'll receive a confirmation email and a short welcome form to help Felicia prepare.</p>
          <p className="mt-3 text-sm text-navy-800/70">If nothing arrives within an hour, please check your spam folder or contact us.</p>
        </div>
      </Section>
    </>
  );
}

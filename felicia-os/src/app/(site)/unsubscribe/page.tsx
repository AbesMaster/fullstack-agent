import { PageHero, Section } from "@/components/ui";
import { UnsubscribeButton } from "@/components/UnsubscribeButton";

export const metadata = { title: "Unsubscribe", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ e?: string; t?: string }> }) {
  const { e, t } = await searchParams;
  return (
    <>
      <PageHero title="Email preferences" />
      <Section>
        <div className="mx-auto max-w-md rounded-3xl bg-white p-8 text-center">
          {e && t ? <UnsubscribeButton email={e} token={t} /> : <p>This link is incomplete. Please use the link in your email.</p>}
        </div>
      </Section>
    </>
  );
}

import { PageHero, Section } from "@/components/ui";
import { PortalConfirmSignIn } from "@/components/portal/PortalSignInForm";

export const metadata = { title: "Sign in", robots: { index: false } };

/** Opening the emailed link shows a button; the token is only used when the person presses it. */
export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return (
    <>
      <PageHero title="Sign in to your client area" />
      <Section>
        <div className="mx-auto max-w-md rounded-3xl bg-white p-8 text-center">
          {t ? <PortalConfirmSignIn token={t} /> : <p>This link is incomplete. Please use the link in your email, or request a new one from the client portal.</p>}
        </div>
      </Section>
    </>
  );
}

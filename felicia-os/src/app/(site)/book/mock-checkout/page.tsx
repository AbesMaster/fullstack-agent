import { notFound } from "next/navigation";
import { PageHero, Section } from "@/components/ui";
import { MockPayButton } from "@/components/MockPayButton";
import { env } from "@/lib/config/env";
import { formatMoney } from "@/lib/util";

/** DEVELOPMENT/DEMO ONLY: stands in for Stripe Checkout when no Stripe keys are configured. */
export default async function Page({ searchParams }: { searchParams: Promise<{ ref?: string; amount?: string }> }) {
  if (env().APP_ENV === "production" || env().STRIPE_SECRET_KEY) notFound();
  const { ref, amount } = await searchParams;
  return (
    <>
      <PageHero eyebrow="Test mode" title="Mock checkout" />
      <Section>
        <div className="mx-auto max-w-md rounded-3xl border-2 border-dashed border-gold bg-white p-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-earth">Not a real payment</p>
          <p className="mt-3">This page simulates the payment provider in development. No money moves.</p>
          <p className="mt-4 font-display text-3xl">{formatMoney(Number(amount ?? 0))}</p>
          <MockPayButton reference={ref ?? ""} amountMinor={Number(amount ?? 0)} />
        </div>
      </Section>
    </>
  );
}

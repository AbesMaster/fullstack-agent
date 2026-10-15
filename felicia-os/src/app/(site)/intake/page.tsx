import { eq } from "drizzle-orm";
import { PageHero, Section, Disclaimer } from "@/components/ui";
import { IntakeForm } from "@/components/IntakeForm";
import { db } from "@/lib/server";
import { bookings, intakeRecords } from "@/lib/db/schema";
import { getService } from "@/lib/services/catalogue";
import { verifyResourceToken } from "@/lib/security/tokens";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome & consent form", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ b?: string; t?: string }> }) {
  const { b, t } = await searchParams;
  const valid = !!b && !!t && verifyResourceToken("intake", b, t);
  const d = await db();
  const [booking] = valid ? await d.select().from(bookings).where(eq(bookings.id, b!)) : [];
  const service = booking ? await getService(d, booking.serviceId) : undefined;
  const [existing] = booking ? await d.select({ id: intakeRecords.id }).from(intakeRecords).where(eq(intakeRecords.bookingId, booking.id)) : [];
  return (
    <>
      <PageHero eyebrow="Before your session" title="Welcome & consent" />
      <Section>
        <div className="mx-auto max-w-2xl space-y-6">
          {!booking || !service ? (
            <p className="rounded-2xl bg-white p-6">This link is invalid or has expired. Please reply to your booking email and we'll send a new one.</p>
          ) : existing ? (
            <p className="rounded-2xl bg-white p-6">Thank you — your form has already been received. If anything has changed, please reply to your booking email.</p>
          ) : (
            <>
              <Disclaimer>Your answers are encrypted and seen only by Felicia. They are never added to our mailing systems or shared with AI tools. {SITE.wellbeingDisclaimer}</Disclaimer>
              <div className="rounded-3xl bg-white p-8">
                <IntakeForm bookingId={booking.id} token={t!} serviceName={service.name} breathwork={service.bookingRules.breathworkScreening} />
              </div>
            </>
          )}
        </div>
      </Section>
    </>
  );
}

import Link from "next/link";
import type { Service } from "@/lib/services/catalogue";
import { formatPriceRange } from "@/lib/util";

const unit = (s: Service) => (s.priceUnit === "per_participant" ? " per person" : s.priceUnit === "per_programme" ? " for the programme" : "");
const mode = { online: "Online", in_person: "In person", hybrid: "Online or in person" } as const;

export function ServiceCard({ s }: { s: Service }) {
  return (
    <article className="flex flex-col rounded-3xl border border-navy-900/10 bg-white p-7 shadow-sm transition hover:shadow-md">
      <p className="text-xs font-semibold uppercase tracking-widest text-lavender-deep">{s.category}</p>
      <h3 className="mt-2 text-2xl text-navy-900">{s.name}</h3>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-navy-800/80">{s.description}</p>
      <dl className="mt-5 grid grid-cols-2 gap-2 text-sm">
        {s.durationMinutes && (
          <div>
            <dt className="text-navy-800/60">Duration</dt>
            <dd>{s.durationMinutes >= 120 && s.durationMinutes % 60 === 0 ? `${s.durationMinutes / 60} hours` : `${s.durationMinutes} minutes`}</dd>
          </div>
        )}
        <div>
          <dt className="text-navy-800/60">Format</dt>
          <dd>{mode[s.deliveryMode]}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-navy-800/60">Investment</dt>
          <dd className="font-display text-2xl text-navy-900">
            {formatPriceRange(s.priceMinor, s.priceMaxMinor, s.currency)}
            <span className="font-sans text-sm text-navy-800/70">{unit(s)}</span>
          </dd>
          {!s.ownerApprovedPrice && s.priceMinor > 0 && <dd className="mt-1 text-xs text-earth">Pricing is being finalised and may change before booking opens.</dd>}
        </div>
      </dl>
      <div className="mt-6 flex flex-wrap gap-3">
        {s.bookingRules.requiresDiscoveryCall ? (
          <Link href="/book?service=discovery-call" className="rounded-full bg-navy-900 px-5 py-2.5 text-sm text-ivory hover:bg-navy-700" data-analytics={`cta_service_discovery_${s.id}`}>
            Start with a free discovery call
          </Link>
        ) : (
          <Link href={`/book?service=${s.id}`} className="rounded-full bg-navy-900 px-5 py-2.5 text-sm text-ivory hover:bg-navy-700" data-analytics={`cta_service_book_${s.id}`}>
            {s.priceMinor === 0 ? "Book now" : "Check availability"}
          </Link>
        )}
      </div>
    </article>
  );
}

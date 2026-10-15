import Link from "next/link";
import type { ReactNode } from "react";

export function PageHero({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <section className="starfield text-ivory">
      <div className="mx-auto max-w-4xl px-4 py-20 text-center md:py-28">
        {eyebrow && <p className="animate-fade-up text-xs font-semibold uppercase tracking-[0.3em] text-gold">{eyebrow}</p>}
        <h1 className="animate-fade-up mt-4 text-4xl leading-tight md:text-6xl">{title}</h1>
        {children && <div className="animate-fade-up mx-auto mt-6 max-w-2xl text-lg text-ivory/80">{children}</div>}
      </div>
    </section>
  );
}

export function Section({ children, tone = "ivory", className = "" }: { children: ReactNode; tone?: "ivory" | "white" | "lavender"; className?: string }) {
  const bg = tone === "white" ? "bg-white" : tone === "lavender" ? "bg-lavender/15" : "bg-ivory";
  return (
    <section className={`${bg} ${className}`}>
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">{children}</div>
    </section>
  );
}

export function CtaButton({ href, children, variant = "gold", analytics }: { href: string; children: ReactNode; variant?: "gold" | "outline" | "navy"; analytics?: string }) {
  const cls =
    variant === "gold"
      ? "bg-gold text-navy-950 hover:bg-gold-soft"
      : variant === "navy"
        ? "bg-navy-900 text-ivory hover:bg-navy-700"
        : "border border-current hover:bg-white/10";
  return (
    <Link href={href} data-analytics={analytics} className={`inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-medium transition ${cls}`}>
      {children}
    </Link>
  );
}

/** Visible placeholder for owner-supplied assets. Never replaced with stock or invented content. */
export function MissingAsset({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div role="img" aria-label={`Placeholder: ${label}`} className={`flex items-center justify-center rounded-2xl border-2 border-dashed border-lavender-deep/40 bg-lavender/10 p-6 text-center text-sm text-lavender-deep ${className}`}>
      <span>
        <span className="block text-xs font-semibold uppercase tracking-widest">Asset needed</span>
        {label}
      </span>
    </div>
  );
}

export function Disclaimer({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-earth/20 bg-white/60 p-4 text-sm leading-relaxed text-navy-800/80">{children}</p>;
}

export function Prose({ children }: { children: ReactNode }) {
  return <div className="prose-felicia mx-auto max-w-3xl space-y-5 text-base leading-relaxed text-navy-800 [&_h2]:mt-10 [&_h2]:text-3xl [&_h2]:text-navy-900 [&_h3]:mt-6 [&_h3]:text-xl [&_li]:ml-5 [&_li]:list-disc">{children}</div>;
}

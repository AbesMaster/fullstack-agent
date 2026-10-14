"use client";
import Link from "next/link";
import { useState } from "react";
import { NAV, SITE } from "@/lib/site";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-navy-950/90 text-ivory backdrop-blur">
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" className="font-display text-2xl tracking-wide text-gold-soft" aria-label={`${SITE.name} home`}>
          MetaMasterMindz
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-6 lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-sm text-ivory/80 transition hover:text-gold-soft">
              {n.label}
            </Link>
          ))}
          <Link href="/book?service=discovery-call" className="rounded-full bg-gold px-4 py-2 text-sm font-medium text-navy-950 transition hover:bg-gold-soft" data-analytics="cta_header_discovery">
            Book a free call
          </Link>
        </nav>
        <button
          type="button"
          className="rounded-md p-2 lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-white/10 px-4 pb-6 lg:hidden">
          <ul className="flex flex-col gap-1 pt-2">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="block rounded-md px-2 py-3 text-ivory/90 hover:bg-white/5" onClick={() => setOpen(false)}>
                  {n.label}
                </Link>
              </li>
            ))}
            <li className="pt-3">
              <Link href="/book?service=discovery-call" className="block rounded-full bg-gold px-4 py-3 text-center font-medium text-navy-950" onClick={() => setOpen(false)}>
                {SITE.primaryCta}
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}

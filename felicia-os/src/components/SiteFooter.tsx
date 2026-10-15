import Link from "next/link";
import { SITE } from "@/lib/site";
import { contactEmail } from "@/lib/config/env";

export function SiteFooter() {
  return (
    <footer className="starfield text-ivory/80">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="font-display text-2xl text-gold-soft">MetaMasterMindz</p>
          <p className="mt-2 font-display text-lg italic text-ivory/70">{SITE.philosophy}</p>
          <p className="mt-6 max-w-md text-xs leading-relaxed text-ivory/60">{SITE.wellbeingDisclaimer}</p>
        </div>
        <nav aria-label="Experiences">
          <p className="text-xs font-semibold uppercase tracking-widest text-gold">Experiences</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link href="/sessions">Private sessions</Link></li>
            <li><Link href="/couples">Couples</Link></li>
            <li><Link href="/programmes">Programmes</Link></li>
            <li><Link href="/return-to-wonder">Return to Wonder</Link></li>
            <li><Link href="/events">Events & workshops</Link></li>
          </ul>
        </nav>
        <nav aria-label="Information">
          <p className="text-xs font-semibold uppercase tracking-widest text-gold">Information</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link href="/about">About Felicia</Link></li>
            <li><Link href="/testimonials">Testimonials</Link></li>
            <li><Link href="/faq">FAQ</Link></li>
            <li><Link href="/contact">Contact</Link></li>
            <li><Link href="/privacy">Privacy policy</Link></li>
            <li><Link href="/terms">Terms & conditions</Link></li>
            <li><Link href="/cancellation-policy">Cancellation & refunds</Link></li>
            <li><Link href="/portal">Client portal</Link></li>
            <li><a href={`mailto:${contactEmail()}`}>{contactEmail()}</a></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/10 py-6 text-center text-xs text-ivory/50">
        © {new Date().getFullYear()} {SITE.name}. All rights reserved.
      </div>
    </footer>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — Felicia Stefan | Spiritual Wellness & Personal Development`, template: `%s | ${SITE.name}` },
  description: SITE.heroSub,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    locale: "en_GB",
    title: `${SITE.name} — ${SITE.heroTitle}`,
    description: SITE.heroSub,
    // images: ["/og.jpg"] — [MISSING ASSET] 1200×630 share image awaiting approval
  },
  robots: process.env.APP_ENV === "production" ? { index: true, follow: true } : { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#111836", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

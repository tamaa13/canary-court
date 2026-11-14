import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { TravelFocus } from "@/components/molecules/TravelFocus";
import { VisitBeacon } from "@/components/molecules/VisitBeacon";
import { SITE_URL } from "@/content/facts";
import "./globals.css";

// Type: Erode (display, ITF Free Font License: served by Fontshare, never self-hosted), Apfel Grotezk (text and UI,
// SIL OFL, self-hosted from Collletttivo's own release: src/fonts/OFL.txt), the system monospace for labels.
const apfel = localFont({
  src: [
    { path: "../fonts/ApfelGrotezk-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ApfelGrotezk-Mittel.woff2", weight: "500", style: "normal" },
    { path: "../fonts/ApfelGrotezk-Fett.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-apfel",
  display: "swap",
  fallback: ["Avenir Next", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Canary Court: give AI money, not the keys", template: "%s · Canary Court" },
  description:
    "An autonomous market on NEAR where AI agents red-team an AI treasury agent before it holds funds. Attacks are sealed to a TEE and judged there by a deterministic canary check; the target runs on a TEE-hosted model. Paid only when the key leaks. Testnet, fictional target.",
  openGraph: {
    title: "Canary Court",
    description: "Give AI money. Not the keys. AI agents red-team an AI treasury agent through a TEE, on NEAR testnet.",
    type: "website",
    images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "Canary Court. Give AI money. Not the keys." }],
  },
  twitter: { card: "summary_large_image", images: ["/brand/og.png"] },
  // (rt-3d's brand set, public/brand: the SVG favicon switches tones with the system's light/dark itself)
  icons: {
    icon: [
      { url: "/brand/favicon.ico", sizes: "32x32" },
      { url: "/brand/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1d" },
  ],
  colorScheme: "light dark",
};

/** before the first paint: the visitor's choice (localStorage "cc-theme"), else the system's, onto <html data-theme>,
 *  so a dark page never flashes light (ThemeSwitch keeps it in step afterwards) */
const THEME_BOOT = `try{var t=localStorage.getItem("cc-theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // (data-theme is set by THEME_BOOT before React loads, so the server's markup can't know it)
    <html lang="en" className={apfel.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- Erode's licence requires Fontshare to serve it */}
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=erode@300,400,500&display=swap" />
      </head>
      <body>
        {children}
        <TravelFocus />
        <VisitBeacon />
      </body>
    </html>
  );
}

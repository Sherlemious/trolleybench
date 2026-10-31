import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";
import Analytics from "./Analytics";
import SiteFooter from "./SiteFooter";
import { GA_ID, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "../lib/site";
import "./globals.css";
import "./scene.css";
import "./results.css";
import "./site.css";
import "./pages.css";
import "./scroll.css";
import "./strip.css";
import "./identity.css";
import "./themes.css";

/* Self-hosted by Next at build time: no request to Google from the visitor, no layout shift. */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "trolleybench · would a language model pull the lever?", template: "%s · trolleybench" },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "trolley problem",
    "AI ethics benchmark",
    "LLM moral reasoning",
    "moral dilemmas",
    "language model evaluation",
    "AI alignment",
    "footbridge dilemma",
    "say versus do",
    "agent evaluation",
    "MCP",
  ],
  authors: [{ name: "trolleybench contributors", url: "https://github.com/Sherlemious/trolleybench" }],
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_GB", url: "/" },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  category: "technology",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
  ],
};

/** Runs before paint, so a saved light/dark choice never flashes the other theme first. */
const THEME_BOOT = `try{var d=document.documentElement,t=localStorage.getItem("tb-theme"),a=localStorage.getItem("tb-accent"),m={light:"light",dark:"dark",sepia:"light",midnight:"dark",terminal:"dark"};if(t&&m[t]){d.setAttribute("data-theme",t);d.setAttribute("data-mode",m[t])}if(a==="blue"||a==="green"||a==="red")d.setAttribute("data-accent",a)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {/* Google tag, as Google asks: once, high in <head>. Page views are sent by <Analytics />. */}
        <script async src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}',{send_page_view:false});`,
          }}
        />
      </head>
      <body>
        {children}
        <SiteFooter />
        <Suspense fallback={null}>
          <Analytics />
        </Suspense>
      </body>
    </html>
  );
}

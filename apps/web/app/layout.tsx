import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import SiteFooter from "./SiteFooter";
import "./globals.css";
import "./scene.css";
import "./results.css";
import "./site.css";
import "./pages.css";
import "./scroll.css";
import "./strip.css";
import "./identity.css";

/* Self-hosted by Next at build time: no request to Google from the visitor, no layout shift. */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "trolleybench",
  description:
    "An open, reproducible benchmark of how language models answer moral dilemmas, beside published human responses.",
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
const THEME_BOOT = `try{var t=localStorage.getItem("tb-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        {children}
        <SiteFooter />
        <Script src="https://www.googletagmanager.com/gtag/js?id=G-M3QHMNTN74" strategy="afterInteractive" />
        <Script id="gtag-init" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-M3QHMNTN74');`}
        </Script>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import "./scene.css";
import "./results.css";
import "./site.css";
import "./pages.css";

export const metadata: Metadata = {
  title: "trolleybench",
  description:
    "An open, reproducible benchmark of how language models answer moral dilemmas, beside published human responses.",
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f6f7" }, { media: "(prefers-color-scheme: dark)", color: "#0d1217" }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Spectral:ital,wght@0,400;0,500;1,400&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

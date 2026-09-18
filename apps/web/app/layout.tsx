import type { Metadata } from "next";
import "./globals.css";
import "./scene.css";

export const metadata: Metadata = {
  title: "trolleybench — scenario workbench",
  description:
    "Browse the parameterized moral-dilemma scenario library: change a design factor and watch the stimulus and its content hash recompute.",
};

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

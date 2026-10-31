/** The canonical origin: metadata, the sitemap and the docs' copy-paste examples all use it. */
export const SITE_URL = (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://trolley-bench.sherlemious.com").replace(/\/+$/, "");

export const SITE_NAME = "trolleybench";

export const SITE_DESCRIPTION =
  "An open, reproducible benchmark of how language models answer moral dilemmas: the classic trolley problems and dilemmas only an AI faces, set beside published human responses.";

/** Google Analytics 4 measurement id. Kept here, not in a client module, so server code reads a string. */
export const GA_ID = "G-M3QHMNTN74";

/**
 * Page metadata with its own title, description and canonical URL. Built through one
 * helper because a page that sets openGraph replaces the inherited object wholesale, and
 * would otherwise lose the share image.
 */
export function pageMeta(title: string, path: string, description: string) {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      type: "website" as const,
      images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "trolleybench: would a language model pull the lever?" }],
    },
  };
}

import type { MetadataRoute } from "next";
import { listEntries } from "../lib/runs";
import { SITE_URL } from "../lib/site";

/** Every page, plus one page per model entry, so each model's results can be found by search. */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1, lastModified: now },
    { url: `${SITE_URL}/results`, changeFrequency: "hourly", priority: 0.9, lastModified: now },
    { url: `${SITE_URL}/play`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/run`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/workbench`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/docs`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/sources`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.2 },
  ];
  const entries = (await listEntries()).filter((e) => !e.isStub);
  return [
    ...pages,
    ...entries.map((e) => ({
      url: `${SITE_URL}/results/${encodeURIComponent(e.id)}`,
      lastModified: new Date(e.finishedAt ?? e.startedAt),
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { cache } from "react";
import { parse } from "yaml";
import { z } from "zod";
import { expandSuite, loadPackDir, loadSuiteFile } from "@trolleybench/scenarios";

/**
 * Content-driven presentation: how the site shows each pack, and which suites it can run.
 *
 * Both come from `content/`, so a new pack or suite appears on the results page, the run
 * page, the API and MCP without a change to this app. Presentation lives in a pack's
 * `site.yaml`, beside `pack.yaml` and outside it, so wording changes never move a pack
 * digest, an instance hash or a frozen suite.
 */

/** The repo root. The site runs from apps/web; tests point this at the repo directly. */
const ROOT = process.env["TROLLEYBENCH_ROOT"] ?? resolve(process.cwd(), "..", "..");

const Mode = z.object({ title: z.string(), body: z.string() });
const TourStep = z.object({
  template: z.string(),
  cell: z.record(z.string()),
  title: z.string(),
  blurb: z.string(),
});
const PackSite = z.object({
  tab: z.string(),
  title: z.string(),
  intro: z.string(),
  modes: z.record(Mode).default({}),
  suite: z.string().optional(),
  tour: z.array(TourStep).optional(),
});
export type PackSite = z.infer<typeof PackSite>;
export type TourStep = z.infer<typeof TourStep>;

/** Every pack's presentation, keyed by pack id. A pack without a site.yaml is shown by its id. */
export const packSites = cache(async (): Promise<Record<string, PackSite>> => {
  const dir = resolve(ROOT, "content", "packs");
  const out: Record<string, PackSite> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const raw = await readFile(resolve(dir, entry.name, "site.yaml"), "utf8").catch(() => null);
    if (raw === null) continue;
    const pack = parse(await readFile(resolve(dir, entry.name, "pack.yaml"), "utf8")) as { id?: string };
    const parsed = PackSite.safeParse(parse(raw));
    if (!parsed.success) throw new Error(`content/packs/${entry.name}/site.yaml: ${parsed.error.message}`);
    out[pack.id ?? entry.name] = parsed.data;
  }
  return out;
});

export function packSite(sites: Record<string, PackSite>, pack: string): PackSite {
  return sites[pack] ?? { tab: pack, title: pack, intro: "", modes: {} };
}

export interface SuiteInfo {
  id: string;
  title: string;
  description: string;
  packs: string[];
  /** The pack's display name, for the run page. */
  label: string;
  /** Every instance: the "full" hosted size. */
  full: number;
  /** The unsteered arm only: the "quick" hosted size (packages/session). */
  quick: number;
  scenarios: number;
}

/** Every suite in content/suites, sized the way packages/session will size a hosted run. */
export const listSuites = cache(async (): Promise<SuiteInfo[]> => {
  const packs = await loadPackDir(resolve(ROOT, "content", "packs"));
  const sites = await packSites();
  const dir = resolve(ROOT, "content", "suites");
  const files = (await readdir(dir)).filter((f) => /\.ya?ml$/.test(f) && !f.includes(".lock")).sort();
  const out: SuiteInfo[] = [];
  for (const f of files) {
    const suite = await loadSuiteFile(resolve(dir, f));
    if (suite.visibility && suite.visibility !== "public") continue;
    const items = expandSuite(packs, suite);
    out.push({
      id: suite.id,
      title: suite.title,
      description: suite.description ?? "",
      packs: suite.packs,
      label: suite.packs.map((p) => packSite(sites, p).tab).join(" + "),
      full: items.length,
      quick: items.filter((i) => i.variation.moral_framework === "none").length,
      scenarios: new Set(items.map((i) => i.template_id)).size,
    });
  }
  // The flagship first.
  return out.sort((a, b) => Number(b.id === "canon.v0") - Number(a.id === "canon.v0") || a.title.localeCompare(b.title));
});

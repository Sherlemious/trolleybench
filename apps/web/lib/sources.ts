import { resolve } from "node:path";
import { loadBaselines, loadPackDir } from "@trolleybench/scenarios";
import type { HumanBaseline, Reference } from "@trolleybench/spec";

const ROOT = resolve(process.cwd(), "..", "..");

export interface UiReference {
  citekey: string;
  kind: Reference["kind"];
  /** "Hauser et al. 2007" - what a chart label or an inline citation shows. */
  short: string;
  /** Full formatted reference, without the link. */
  full: string;
  href: string | null;
  doi: string | null;
  checked: { by: "human" | "agent"; on: string; against: string } | null;
  verified: boolean;
}

export interface UiBaseline {
  id: string;
  templateId: string;
  factors: Record<string, string>;
  measure: HumanBaseline["measure"];
  asked: string;
  value: number | null;
  ci: [number, number] | null;
  finding: string | null;
  n: number | null;
  population: string;
  citekey: string;
  via: string | null;
  quote: string;
  note: string | null;
}

export interface SourcesData {
  references: UiReference[];
  byKey: Record<string, UiReference>;
  baselines: UiBaseline[];
  templateTitles: Record<string, string>;
}

export const MEASURE_LABEL: Record<HumanBaseline["measure"], string> = {
  permissible: "judged it permissible",
  should_act: "said the agent should act",
  would_act: "said they would act",
  acceptability_rating: "rated acceptability",
};

export async function loadSources(): Promise<SourcesData> {
  const packs = await loadPackDir(resolve(ROOT, "content", "packs"));
  const { references, baselines } = await loadBaselines(resolve(ROOT, "content"), packs);

  const ui = [...references.values()].map(toUiReference);
  // Bibliographies read alphabetically by first author, then year. These are works, not
  // levels of a design factor, so ordering them is not a ranking of anything.
  ui.sort((a, b) => a.full.localeCompare(b.full));

  return {
    references: ui,
    byKey: Object.fromEntries(ui.map((r) => [r.citekey, r])),
    baselines: baselines.map((b) => ({
      id: b.id,
      templateId: b.template_id,
      factors: b.factors,
      measure: b.measure,
      asked: b.asked,
      value: b.value ?? null,
      ci: b.ci ?? null,
      finding: b.finding ?? null,
      n: b.n ?? null,
      population: b.population,
      citekey: b.citekey,
      via: b.via ?? null,
      quote: b.quote,
      note: b.note ?? null,
    })),
    templateTitles: Object.fromEntries(
      packs.flatMap((lp) => lp.pack.templates.map((t) => [t.id, t.title] as const)),
    ),
  };
}

function toUiReference(r: Reference): UiReference {
  const surname = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;
  const people = r.authors.filter((a) => a !== "et al.");
  const etAl = r.authors.includes("et al.") || people.length > 2;
  const short =
    r.kind === "press"
      ? `${r.venue} ${r.year}`
      : etAl
        ? `${surname(people[0]!)} et al. ${r.year}`
        : people.length === 2
          ? `${surname(people[0]!)} & ${surname(people[1]!)} ${r.year}`
          : `${surname(people[0]!)} ${r.year}`;

  const authorList =
    r.kind === "press" ? "" : `${r.authors.join(", ")} (${r.year}). `;
  const where = [
    r.venue,
    r.volume ? `${r.volume}${r.issue ? `(${r.issue})` : ""}` : null,
    r.pages ?? null,
  ]
    .filter(Boolean)
    .join(", ");
  const full = `${authorList}${r.title}. ${where}${r.kind === "press" ? `, ${r.year}` : ""}.`;

  return {
    citekey: r.citekey,
    kind: r.kind,
    short,
    full,
    href: r.doi ? `https://doi.org/${r.doi}` : (r.url ?? null),
    doi: r.doi ?? null,
    checked: r.checked ?? null,
    verified: r.verified,
  };
}

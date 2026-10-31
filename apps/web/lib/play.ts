import { loadOverview } from "./analysis";
import { loadWorkbenchData, type UiInstance, type UiTemplate } from "./load";
import { MEASURE_LABEL } from "./sources";
import { packSite, packSites } from "./content";

/**
 * The guided tour: five canonical dilemmas, each in the exact cell the human studies
 * asked about (five versus one, no framework, options as authored), so "how people
 * answered" is shown beside the question it was actually an answer to.
 */

export interface PlayPerson {
  short: string;
  href: string | null;
  value: number | null;
  measure: string;
  finding: string | null;
  population: string;
}

export interface PlayModel {
  /** The model entry's id, for the link to its run page. */
  id: string;
  label: string;
  slot: number;
  rate: number | null;
  interval: [number, number] | null;
  n: number;
}

export interface PlayStep {
  key: string;
  title: string;
  blurb: string;
  template: UiTemplate;
  instance: UiInstance;
  cell: Record<string, string>;
  people: PlayPerson[];
  models: PlayModel[];
  /** Agents that acted over MCP: a different measurement, shown apart from models. */
  agents: PlayModel[];
}


export async function loadPlayData(): Promise<{ steps: PlayStep[]; hasModels: boolean }> {
  const [bench, overview, sites] = await Promise.all([loadWorkbenchData(), loadOverview(), packSites()]);
  // The tour is content: content/packs/classic/site.yaml.
  const TOUR = packSite(sites, "classic").tour ?? [];
  const prompt = overview.groups.find((g) => g.mode === "prompt");
  const agentGroup = overview.groups.find((g) => g.mode === "mcp_tool");

  const steps: PlayStep[] = [];
  for (const t of TOUR) {
    const template = bench.templates.find((x) => x.id === t.template);
    if (!template) continue;
    const instance = bench.instances.find(
      (i) =>
        i.template_id === t.template &&
        i.framework === "none" &&
        i.order === "as_authored" &&
        Object.entries(t.cell).every(([k, v]) => i.factors[k] === v),
    );
    if (!instance) continue;

    const comparison = prompt?.comparisons.find((c) => c.templateId === t.template);
    const people: PlayPerson[] = (comparison?.baselines ?? []).map((b) => ({
      short: b.short,
      href: b.href,
      value: b.value,
      measure: MEASURE_LABEL[b.measure],
      finding: b.finding,
      population: b.population,
    }));
    const toPlay = (list: NonNullable<typeof comparison>["models"]): PlayModel[] =>
      list.map((m) => {
        // The trapdoor step is one level of a factor, so read the model at that level.
        const level = m.byLevel.find((l) => l.level === t.cell["mechanism_variant"]);
        const rate = level ? level.rate : m.rate;
        return { id: m.run.id, label: m.run.label, slot: m.run.slot, rate: rate?.actRate ?? null, interval: rate?.interval ?? null, n: rate?.nValid ?? 0 };
      });
    const models = toPlay(comparison?.models ?? []);
    const agents = toPlay(agentGroup?.comparisons.find((c) => c.templateId === t.template)?.models ?? []);

    steps.push({ key: t.template, title: t.title, blurb: t.blurb, template, instance, cell: t.cell, people, models, agents });
  }
  return { steps, hasModels: (prompt?.models.length ?? 0) > 0 };
}

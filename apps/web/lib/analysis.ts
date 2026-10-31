import { cache } from "react";
import { partitionByMode, scopeToMode, type ScenarioInstance } from "@trolleybench/spec";
import {
  amce,
  authoritativeRows,
  benjaminiHochberg,
  optionOrderConsistency,
  parseAxis,
  ratesBy,
  refusalProfile,
  sayDoGap,
  type AmceResult,
  type RateSummary,
} from "@trolleybench/analysis";
import { buildPrompt } from "@trolleybench/runner";
import { findRun, listEntries, listRuns, loadRun, packsOnce, type RunInfo, type RunSource } from "./runs";
import { loadSources, type UiBaseline } from "./sources";

export type { RunInfo } from "./runs";
export { listEntries, listRuns } from "./runs";

/** Axes worth offering. Each names its own reference level. */
export const AXES = [
  { spec: "moral_framework", label: "Moral framework", baseline: "none" },
  { spec: "option_order", label: "Option order", baseline: "as_authored" },
  { spec: "factor:ratio", label: "Victim ratio", baseline: "r1v5" },
  { spec: "factor:personal_force", label: "Personal force", baseline: "absent" },
  { spec: "factor:harm_role", label: "Harm role", baseline: "side_effect" },
] as const;

export interface UiLevel {
  level: string;
  isBaseline: boolean;
  n: number;
  nValid: number;
  actRate: number | null;
  estimate: number | null;
  ci: [number, number] | null;
  qValue: number | null;
}

export interface UiAmce {
  axis: string;
  label: string;
  baseline: string;
  levels: UiLevel[];
  /** Absent when the axis does not apply to any instance in this run. */
  unavailable?: string;
}

export interface UiRate {
  actRate: number | null;
  interval: [number, number] | null;
  nValid: number;
  total: number;
  refusal: number;
}

export type UiSourcedBaseline = UiBaseline & { short: string; href: string | null; viaShort: string | null };

/** One model's answers on the cells a scenario's human studies asked about. */
export interface ModelOnScenario {
  run: RunInfo;
  rate: UiRate | null;
  /** For a qualitative baseline: the model per level of the contrasted factor. */
  byLevel: Array<{ level: string; rate: UiRate }>;
}

/** One scenario's human baselines beside one or more models. */
export interface Comparison {
  templateId: string;
  title: string;
  /** Which cells the model rates are computed over, in words. */
  cells: string;
  baselines: UiSourcedBaseline[];
  models: ModelOnScenario[];
}

export interface RunSummary {
  run: RunInfo;
  overall: RateSummary;
  flipRate: number | null;
  pairs: number;
}

export interface ResultsData {
  available: boolean;
  run: RunInfo | null;
  /** Model entries, for the switcher. */
  runs: RunInfo[];
  /** The individual sessions behind the entry on screen (just itself for a single run). */
  sessions: RunInfo[];
  mode: string;
  overall: RateSummary | null;
  clusters: number;
  superseded: number;
  orphans: number;
  amces: UiAmce[];
  consistency: {
    pairs: number;
    flips: number;
    flipRate: number | null;
    ci: [number, number] | null;
    unpaired: number;
  } | null;
  refusalByTemplate: { group: string; title: string; refusalRate: number; n: number }[];
  comparisons: Comparison[];
  grid: {
    templates: Array<{ id: string; title: string; summary?: string }>;
    frameworks: string[];
    cells: Record<string, UiRate>;
  };
}

/** One elicitation mode's models. Modes are never pooled, so each gets its own panel. */
export interface ModeGroup {
  mode: string;
  pack: string;
  models: RunSummary[];
  comparisons: Comparison[];
}

/** One level of one factor: the same counts as a scenario, over just its cells. */
export interface SayDoLevel {
  id: string;
  label: string;
  pairs: number;
  saidAct: number;
  didAct: number;
  hollow: number;
}

/** One axis of a scenario's design, broken down level by level. */
export interface SayDoFactor {
  id: string;
  /** Plural, for the design line: "rules". */
  label: string;
  /** As a heading: "rule", "lives", "option order". */
  name: string;
  description: string | null;
  levels: SayDoLevel[];
}

/** Per scenario: how often the model said it would act, and how often it then did. */
export interface SayDoTemplate {
  templateId: string;
  title: string;
  pairs: number;
  saidAct: number;
  didAct: number;
  hollow: number;
  /** How the scenario's cells are built, e.g. "5 rules × 3 lives × 2 certainty × 2 option orders". */
  design: string;
  /** Every factor of the design, plus option order, broken down by level. */
  factors: SayDoFactor[];
}

/**
 * One model that answered a pack both ways: asked (prompt) and handed tools (mcp_tool).
 * The two sessions are compared cell by cell, never pooled into one rate.
 */
export interface SayDoModel {
  label: string;
  slot: number;
  saidId: string;
  didId: string;
  pairs: number;
  saidAct: number;
  didAct: number;
  saidButDidNot: number;
  didButDidNotSay: number;
  hollow: number;
  templates: SayDoTemplate[];
}

/** A scenario as the results page introduces it. */
export interface ScenarioGuide {
  id: string;
  title: string;
  summary: string | null;
}

/** One model's two responses to the example dilemma: its answer, and its action. */
export interface SayDoExampleAnswer {
  label: string;
  /** The reply as recorded, e.g. "A. Lives outweigh..." */
  said: string | null;
  saidOutcome: string;
  /** The tool the model called, or null if it declined to use any. */
  didTool: string | null;
  /** The content argument it sent, if the tool takes one. */
  didContent: string | null;
  didOutcome: string;
  enactment: string | null;
}

/**
 * One real dilemma shown the way each arm saw it: the exact text of the asked prompt,
 * the exact text and tools of the acting one, and what every model did with each.
 */
export interface SayDoExample {
  templateId: string;
  title: string;
  /** The factor levels of the example cell, in words. */
  cell: string;
  askedPrompt: string;
  actingPrompt: string;
  tools: Array<{ name: string; description: string; args: Record<string, string> }>;
  answers: SayDoExampleAnswer[];
}

/** Every finished run of one scenario pack, by mode, plus its say/do pairs. */
export interface PackSection {
  pack: string;
  groups: ModeGroup[];
  sayDo: SayDoModel[];
  /** The pack's scenarios in pack order, for the guide and for labelling rows. */
  scenarios: ScenarioGuide[];
  /** A worked example of the say/do method, when the pack has say/do pairs. */
  sayDoExample: SayDoExample | null;
}

export interface OverviewData {
  runs: RunInfo[];
  /** The classic canon: `prompt` first, then `mcp_tool`; a mode appears only if it has a finished run. */
  groups: ModeGroup[];
  /** Every other pack, each kept apart from the canon and from each other. */
  packs: PackSection[];
  /** The canon's scenarios, for its guide. */
  classicScenarios: ScenarioGuide[];
  stubs: RunInfo[];
  inProgress: RunInfo[];
  dataSource: "database" | "file" | "mixed" | "none";
}

// ---------------------------------------------------------------------------------

interface Prepared {
  source: RunSource;
  scoped: NonNullable<ReturnType<ReturnType<typeof partitionByMode>["get"]>>;
  superseded: number;
  orphans: number;
}

/** Newest attempt per cell, then partition by mode: the same two steps `trolley analyze` takes. */
const prepare = cache(async (id: string): Promise<Prepared | null> => {
  const source = await loadRun(id);
  if (!source || source.rows.length === 0) return null;
  const authoritative = authoritativeRows(source.rows);
  const scoped = partitionByMode(authoritative).get(source.info.mode);
  if (!scoped) return null;
  return {
    source,
    scoped,
    superseded: source.rows.length - authoritative.length,
    orphans: authoritative.filter((r) => !source.instances.has(r.instance_hash)).length,
  };
});

const templatesOnce = cache(async () => {
  const packs = await packsOnce();
  return packs.flatMap((lp) => lp.pack.templates);
});

/**
 * The model's rate on the cells a scenario's studies asked about: the factor levels the
 * baseline names (5 versus 1, in every study here), no framework steering, both option
 * orders pooled so position cannot masquerade as preference.
 */
async function modelOnScenario(
  p: Prepared,
  templateId: string,
  baselines: UiBaseline[],
): Promise<ModelOnScenario> {
  const factors = baselines.find((b) => b.value !== null)?.factors ?? baselines[0]?.factors ?? {};
  const matches = (i: ScenarioInstance) =>
    i.template_id === templateId &&
    i.variation.moral_framework === "none" &&
    Object.entries(factors).every(([f, level]) => i.factors[f] === level);

  const whole = ratesBy(p.scoped, p.source.instances, (i) => (matches(i) ? "m" : null)).get("m");

  // A baseline with no number predicts a direction across one factor. Show the model
  // per level of that factor, in design order, so the direction can be read off.
  const byLevel: ModelOnScenario["byLevel"] = [];
  if (baselines.length > 0 && baselines.every((b) => b.value === null)) {
    const tpl = (await templatesOnce()).find((t) => t.id === templateId);
    const contrast = tpl?.factors[0];
    if (contrast) {
      const per = ratesBy(p.scoped, p.source.instances, (i) =>
        matches(i) ? (i.factors[contrast.id] ?? null) : null,
      );
      for (const level of contrast.levels) {
        const r = per.get(level.id);
        if (r) byLevel.push({ level: level.id, rate: toRate(r) });
      }
    }
  }
  return { run: p.source.info, rate: whole ? toRate(whole) : null, byLevel };
}

async function comparisonsFor(prepared: Prepared[]): Promise<Comparison[]> {
  const sources = await loadSources();
  const templates = await templatesOnce();
  const out: Comparison[] = [];
  for (const t of templates) {
    const baselines = sources.baselines.filter((b) => b.templateId === t.id);
    if (baselines.length === 0) continue;
    const factors = baselines.find((b) => b.value !== null)?.factors ?? baselines[0]!.factors;
    const described = Object.entries(factors)
      .map(([f, level]) => `${f} = ${level}`)
      .join(", ");
    const models = await Promise.all(prepared.map((p) => modelOnScenario(p, t.id, baselines)));
    // A scenario nobody in this group answered - another pack's dilemma - is not a
    // comparison, just a row of dashes.
    if (models.every((m) => m.rate === null && m.byLevel.length === 0)) continue;
    out.push({
      templateId: t.id,
      title: t.title,
      cells: `${described ? `${described}, ` : ""}no framework, both option orders`,
      baselines: baselines.map((b) => ({
        ...b,
        short: sources.byKey[b.citekey]?.short ?? b.citekey,
        href: sources.byKey[b.citekey]?.href ?? null,
        viaShort: b.via ? (sources.byKey[b.via]?.short ?? b.via) : null,
      })),
      models,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------

/**
 * Every figure for one run, computed through the same @trolleybench/analysis calls
 * `trolley analyze` makes, so a number here and a number in a terminal cannot diverge.
 */
export async function loadResultsData(idOrStem?: string): Promise<ResultsData> {
  const runs = await listEntries();
  const info = await findRun(idOrStem);
  const allSessions = await listRuns();
  const sessions = info ? allSessions.filter((r) => info.sessionIds.includes(r.id)) : [];
  const empty = { ...emptyData(runs), sessions };
  if (!info) return empty;
  const p = await prepare(info.id);
  if (!p) return { ...empty, run: info };

  const { scoped, source } = p;
  const instances = source.instances;
  const bootstrap = { samples: 1000, seed: 0 };

  const amces: UiAmce[] = AXES.map(({ spec, label, baseline }) => {
    try {
      return toUi(amce(scoped, instances, parseAxis(spec), { ...bootstrap, baseline }), label);
    } catch (cause) {
      return { axis: spec, label, baseline, levels: [], unavailable: cause instanceof Error ? cause.message : String(cause) };
    }
  });

  const consistency = optionOrderConsistency(scoped, instances, bootstrap);
  const refusals = refusalProfile(scoped, instances);

  // Templates in pack order, frameworks in design order. Neither is ever re-sorted by a
  // result: invariant 3 forbids a ranked view of levels.
  const templates = (await templatesOnce()).map((t) => ({ id: t.id, title: t.title, ...(t.summary && { summary: t.summary }) }));
  const frameworks = [...new Set([...instances.values()].map((i) => i.variation.moral_framework))];
  const order = ["none", "act_utilitarian", "rule_utilitarian", "kantian_deontological", "virtue_ethics", "contractualist"];
  frameworks.sort((a, b) => rank(order, a) - rank(order, b));

  const gridRates = ratesBy(scoped, instances, (i) => `${i.template_id}|${i.variation.moral_framework}`);
  const cells: Record<string, UiRate> = {};
  for (const [k, r] of gridRates) cells[k] = toRate(r);

  return {
    available: true,
    run: info,
    runs,
    sessions,
    mode: info.mode,
    overall: refusals.overall,
    clusters: new Set(scopedRows(p).map((r) => r.subject_id)).size,
    superseded: p.superseded,
    orphans: p.orphans,
    amces,
    consistency: {
      pairs: consistency.pairs,
      flips: consistency.flips,
      flipRate: consistency.flipRate,
      ci: consistency.ci,
      unpaired: consistency.unpaired,
    },
    refusalByTemplate: templates
      .map((t) => {
        const g = refusals.byTemplate.find((x) => x.group === t.id);
        return g ? { group: t.id, title: t.title, refusalRate: g.rates.refusalRate, n: g.rates.total } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
    comparisons: await comparisonsFor([p]),
    grid: { templates, frameworks, cells },
  };
}

/**
 * Every finished real model, beside the people, one panel per elicitation mode.
 * Stubs and unfinished hosted runs are listed, never plotted.
 */
export async function loadOverview(): Promise<OverviewData> {
  const runs = await listEntries();
  const sessions = await listRuns();
  const finished = runs.filter((r) => !r.isStub);

  const byPack = async (pack: string): Promise<{ groups: ModeGroup[]; prepared: Map<string, Prepared[]> }> => {
    const groups: ModeGroup[] = [];
    const prepared = new Map<string, Prepared[]>();
    for (const mode of ["prompt", "mcp_tool"] as const) {
      const inMode = finished.filter((r) => r.mode === mode && r.pack === pack);
      const ready = (await Promise.all(inMode.map((r) => prepare(r.id)))).filter((p): p is Prepared => p !== null);
      if (ready.length === 0) continue;
      prepared.set(mode, ready);
      groups.push({
        mode,
        pack,
        models: ready.map((p) => {
          const c = optionOrderConsistency(p.scoped, p.source.instances, { samples: 200, seed: 0 });
          return {
            run: p.source.info,
            overall: refusalProfile(p.scoped, p.source.instances).overall,
            flipRate: c.flipRate,
            pairs: c.pairs,
          };
        }),
        comparisons: await comparisonsFor(ready),
      });
    }
    return { groups, prepared };
  };

  const classic = await byPack("classic");
  const others = [...new Set(finished.map((r) => r.pack))].filter((p) => p !== "classic").sort();
  const packs: PackSection[] = [];
  for (const pack of others) {
    const { groups, prepared } = await byPack(pack);
    if (groups.length === 0) continue;
    packs.push({
      pack,
      groups,
      sayDo: await sayDoFor(prepared.get("prompt") ?? [], prepared.get("mcp_tool") ?? []),
      scenarios: await scenariosOf(pack),
      sayDoExample: await sayDoExampleFor(prepared.get("prompt") ?? [], prepared.get("mcp_tool") ?? []),
    });
  }

  const sources = new Set(runs.map((r) => r.source));
  return {
    runs,
    groups: classic.groups,
    packs,
    classicScenarios: await scenariosOf("classic"),
    stubs: runs.filter((r) => r.isStub),
    inProgress: sessions.filter((r) => !r.isStub && !r.complete),
    dataSource: sources.size === 0 ? "none" : sources.size > 1 ? "mixed" : [...sources][0]!,
  };
}

type Template = Awaited<ReturnType<typeof templatesOnce>>[number];
type Pair = ReturnType<typeof sayDoGap>["pairList"][number];

/** A cell key's factor levels, plus its option order: the axes a breakdown can use. */
function cellLevels(cellKey: string): Record<string, string> {
  const [, factors = "", variation = ""] = cellKey.split("|");
  const out: Record<string, string> = Object.fromEntries(
    factors
      .split(",")
      .filter(Boolean)
      .map((kv) => kv.split("=") as [string, string]),
  );
  const order = /option_order="([a-z_]+)"/.exec(variation)?.[1];
  if (order) out["option_order"] = order;
  return out;
}

/** A level in words: its label, else its description, else what its values say. */
function levelLabel(level: Template["factors"][number]["levels"][number]): string {
  if (level.label) return level.label;
  if (level.description) return level.description.replace(/\.$/, "");
  const v = level.values as Record<string, unknown>;
  const n = v["n_threatened"];
  const k = v["n_sacrificed"];
  if (typeof n === "number" && typeof k === "number") return `${n} saved vs ${k} killed`;
  if (typeof n === "number") return `${n.toLocaleString("en")} ${n === 1 ? "life" : "lives"} at stake`;
  if (typeof v["percent"] === "number") return `${v["percent"]}% chance they die anyway`;
  return level.id.replace(/_/g, " ");
}

const PLURAL: Record<string, string> = { rule: "rules", option_order: "option orders" };

/**
 * One scenario's say/do pairs, split along each factor of its design (and option
 * order), levels in design order. Each level is a slice of the same pairs, never a
 * new estimate, so the level counts of any one factor add up to the scenario's.
 */
function breakdown(tpl: Template | undefined, pairs: Pair[]): SayDoFactor[] {
  const axes: Array<{ id: string; label: string; description: string | null; levels: Array<{ id: string; label: string }> }> = [
    ...(tpl?.factors ?? []).map((f) => ({
      id: f.id,
      label: PLURAL[f.id] ?? f.id.replace(/_/g, " "),
      description: f.description ?? null,
      levels: f.levels.map((l) => ({ id: l.id, label: levelLabel(l) })),
    })),
    {
      id: "option_order",
      label: "option orders",
      description: "Whether the options were listed as written or reversed. A control: answers should not depend on it.",
      levels: [
        { id: "as_authored", label: "as written" },
        { id: "reversed", label: "reversed" },
      ],
    },
  ];
  const keyed = pairs.map((p) => ({ p, at: cellLevels(p.cellKey) }));
  return axes
    .map((axis) => ({
      id: axis.id,
      label: axis.label,
      name: axis.id.replace(/_/g, " "),
      description: axis.description,
      levels: axis.levels
        .map((level) => {
          const slice = keyed.filter((k) => k.at[axis.id] === level.id).map((k) => k.p);
          return {
            id: level.id,
            label: level.label,
            pairs: slice.length,
            saidAct: slice.filter((x) => x.said === "act").length,
            didAct: slice.filter((x) => x.did === "act").length,
            hollow: slice.filter((x) => x.did === "hollow").length,
          };
        })
        .filter((l) => l.pairs > 0),
    }))
    .filter((f) => f.levels.length > 1);
}

/**
 * The cell the worked example uses, when a pack has it: the headline dilemma at its
 * starkest - reproduce a copyrighted chapter for 100 confirmed hostages. Any other
 * pack falls back to its first cell answered both ways.
 */
const EXAMPLE_CELL: Record<string, string> = { rule: "copyright", lives: "l100", certainty: "confirmed" };

async function sayDoExampleFor(said: Prepared[], did: Prepared[]): Promise<SayDoExample | null> {
  const pairs = said
    .map((s) => ({
      s,
      d: did.find((x) => x.source.info.label === s.source.info.label && x.source.info.submitter === s.source.info.submitter),
    }))
    .filter((x): x is { s: Prepared; d: Prepared } => x.d !== undefined);
  if (pairs.length === 0) return null;

  const all = [...pairs[0]!.s.source.instances.values(), ...pairs[0]!.d.source.instances.values()];
  const sameCell = (a: ScenarioInstance, b: ScenarioInstance) =>
    a.template_id === b.template_id &&
    a.variation.option_order === b.variation.option_order &&
    JSON.stringify(a.factors) === JSON.stringify(b.factors);
  const asked =
    all.find(
      (i) =>
        i.variation.response_format === "forced_choice" &&
        i.variation.option_order === "as_authored" &&
        Object.entries(EXAMPLE_CELL).every(([f, l]) => i.factors[f] === l),
    ) ?? all.find((i) => i.variation.response_format === "forced_choice");
  if (!asked) return null;
  const acting = all.find((i) => i.variation.response_format === "tool_call" && sameCell(i, asked));
  if (!acting) return null;

  const askedPrompt = buildPrompt(asked);
  const actingPrompt = buildPrompt(acting);
  const tpl = (await templatesOnce()).find((t) => t.id === asked.template_id);
  const levelWords = (factor: string, level: string) => {
    const f = tpl?.factors.find((x) => x.id === factor);
    const l = f?.levels.find((x) => x.id === level);
    return `${factor}: ${l ? levelLabel(l) : level}`;
  };

  return {
    templateId: asked.template_id,
    title: tpl?.title ?? asked.template_id,
    cell: Object.entries(asked.factors)
      .map(([f, l]) => levelWords(f, l))
      .join(", "),
    askedPrompt: askedPrompt.user,
    actingPrompt: actingPrompt.user,
    tools: (actingPrompt.tools ?? []).map(({ name, description, args }) => ({ name, description, args })),
    answers: pairs.map(({ s, d }) => {
      const sr = authoritativeRows(s.source.rows).find((r) => r.instance_hash === asked.hash);
      const dr = authoritativeRows(d.source.rows).find((r) => r.instance_hash === acting.hash);
      const calls = (dr?.raw_response as { tool_calls?: Array<{ name?: string }> } | null)?.tool_calls;
      const content = dr?.tool_arguments?.["content"];
      return {
        label: s.source.info.label,
        said: sr ? (sr.justification_text ?? null) : null,
        saidOutcome: sr?.outcome ?? "not run",
        didTool: calls?.[0]?.name ?? null,
        didContent: typeof content === "string" ? content : null,
        didOutcome: dr?.outcome ?? "not run",
        enactment: dr?.enactment ?? null,
      };
    }),
  };
}

async function scenariosOf(pack: string): Promise<ScenarioGuide[]> {
  const packs = await packsOnce();
  return (packs.find((lp) => lp.pack.id === pack)?.pack.templates ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    summary: t.summary ?? null,
  }));
}

/**
 * Pair each model's stated session with its acting session on the same pack - the same
 * label from the same submitter - and compare them cell by cell. Session-qualified
 * subject ids are put back to one, because the pairing is by subject and cell.
 */
async function sayDoFor(said: Prepared[], did: Prepared[]): Promise<SayDoModel[]> {
  const templates = await templatesOnce();
  const titles = new Map(templates.map((t) => [t.id, t.title]));
  const out: SayDoModel[] = [];
  for (const s of said) {
    const d = did.find(
      (x) => x.source.info.label === s.source.info.label && x.source.info.submitter === s.source.info.submitter,
    );
    if (!d) continue;
    const unify = (p: Prepared) => authoritativeRows(p.source.rows).map((r) => ({ ...r, subject_id: "subject" }));
    const saidRows = scopeToMode(unify(s), "prompt");
    const didRows = scopeToMode(unify(d), "mcp_tool");
    if (!saidRows || !didRows) continue;
    const instances = new Map([...s.source.instances, ...d.source.instances]);
    const gap = sayDoGap(saidRows, didRows, instances);
    out.push({
      label: s.source.info.label,
      slot: s.source.info.slot,
      saidId: s.source.info.id,
      didId: d.source.info.id,
      pairs: gap.pairs,
      saidAct: gap.saidAct,
      didAct: gap.didAct,
      saidButDidNot: gap.saidButDidNot,
      didButDidNotSay: gap.didButDidNotSay,
      hollow: gap.hollow,
      // Pack order, never sorted by the gap: a ranked view of levels is what invariant 3 forbids.
      templates: [...titles.keys()]
        .map((id) => gap.byTemplate.find((t) => t.templateId === id))
        .filter((t): t is NonNullable<typeof t> => t !== undefined)
        .map((t) => {
          const tpl = templates.find((x) => x.id === t.templateId);
          const pairs = gap.pairList.filter((pr) => pr.templateId === t.templateId);
          const factors = breakdown(tpl, pairs);
          return {
            templateId: t.templateId,
            title: titles.get(t.templateId) ?? t.templateId,
            pairs: t.pairs,
            saidAct: t.saidAct,
            didAct: t.didAct,
            hollow: t.hollow,
            design: factors.map((f) => `${f.levels.length} ${f.label}`).join(" × "),
            factors,
          };
        }),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------

function scopedRows(p: Prepared) {
  return authoritativeRows(p.source.rows);
}

function rank(order: string[], v: string): number {
  const i = order.indexOf(v);
  return i === -1 ? order.length : i;
}

function emptyData(runs: RunInfo[]): ResultsData {
  return {
    available: false,
    run: null,
    runs,
    sessions: [],
    mode: "prompt",
    overall: null,
    clusters: 0,
    superseded: 0,
    orphans: 0,
    amces: [],
    consistency: null,
    refusalByTemplate: [],
    comparisons: [],
    grid: { templates: [], frameworks: [], cells: {} },
  };
}

function toRate(r: RateSummary & { interval: [number, number] | null }): UiRate {
  return { actRate: r.actRate, interval: r.interval, nValid: r.nValid, total: r.total, refusal: r.counts.refusal };
}

function toUi(result: AmceResult, label: string): UiAmce {
  const corrected = benjaminiHochberg(result.levels.map((l) => ({ label: l.level, pValue: l.pValue })));
  return {
    axis: result.axis,
    label,
    baseline: result.baseline,
    // Design order is preserved from the estimator. Invariant 3: no surface returns a
    // ranked view of levels, and a chart is a surface.
    levels: result.levels.map((l, i) => ({
      level: l.level,
      isBaseline: l.isBaseline,
      n: l.rates.total,
      nValid: l.rates.nValid,
      actRate: l.rates.actRate,
      estimate: l.estimate,
      ci: l.ci,
      qValue: corrected[i]?.qValue ?? null,
    })),
  };
}

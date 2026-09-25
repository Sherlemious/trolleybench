import { resolve } from "node:path";
import { VariationGrid, type MoralFramework, type OptionOrder } from "@trolleybench/spec";
import {
  expandSuite,
  freezeSuite,
  loadPackDir,
  loadSuiteFile,
  validatePack,
  type LoadedPack,
} from "@trolleybench/scenarios";
import { listRuns, loadRun } from "./runs";
import { loadSources, type UiBaseline, type UiReference } from "./sources";

/**
 * The repo root, relative to this app. Scenario content is read straight from
 * `content/` rather than from a committed export, so the browser can never drift
 * out of sync with the packs the CLI runs.
 */
const ROOT = resolve(process.cwd(), "..", "..");

export interface UiOption {
  id: string;
  label: string;
  polarity: "act" | "omit";
  position: number;
}

export interface UiInstance {
  hash: string;
  template_id: string;
  factors: Record<string, string>;
  framework: MoralFramework;
  order: OptionOrder;
  narrative: string;
  question: string;
  options: UiOption[];
  system_prompt: string | null;
}

export interface UiTemplate {
  id: string;
  title: string;
  mechanism: string;
  tags: string[];
  factors: Array<{
    id: string;
    description?: string;
    /** Level values are what the render template interpolates (n_threatened, ...). The
     *  scene needs them to draw the right number of people on each track. */
    levels: Array<{ id: string; values: Record<string, string | number | boolean> }>;
  }>;
  constraints: Array<{ id: string; description?: string; exclude: Record<string, string[]> }>;
  papers: Array<{ citekey: string; role: string; verified: boolean }>;
}

export interface UiResult {
  h: string;
  o: string;
  c: string | null;
  /** Index into meta.subjects. */
  s: number;
}

export interface UiSubject {
  id: string;
  label: string;
  slot: number;
  mode: string;
  selfReported: boolean;
}

export interface WorkbenchData {
  meta: {
    pack: { id: string; version: string; title: string; digest: string };
    suite: { id: string; version: string; title: string; digest: string };
    instanceCount: number;
    frameworks: MoralFramework[];
    orders: OptionOrder[];
    validationErrors: number;
    resultsRunId: string | null;
    /** Every finished model run, in colour-slot order. Stubs are left out. */
    subjects: UiSubject[];
  };
  templates: UiTemplate[];
  instances: UiInstance[];
  results: UiResult[];
  baselines: UiBaseline[];
  references: Record<string, UiReference>;
}

export async function loadWorkbenchData(): Promise<WorkbenchData> {
  const packs: LoadedPack[] = await loadPackDir(resolve(ROOT, "content", "packs"));
  const suite = await loadSuiteFile(resolve(ROOT, "content", "suites", "canon-v0.yaml"));
  const instances = expandSuite(packs, suite);
  const lock = freezeSuite(packs, suite, () => new Date(0).toISOString());

  const first = packs[0];
  if (!first) throw new Error("no scenario packs found under content/packs");

  // Surfaced in the header rather than thrown: a broken pack should be visible in the
  // UI, not a blank page.
  const validationErrors = packs.reduce(
    (n, p) => n + validatePack(p.pack).filter((d) => d.level === "error").length,
    0,
  );

  // The first committed run, real models before the echo stub. Committed samples
  // rather than `runs/`, which is gitignored: what a deployed page replays is exactly
  // what a fresh clone reproduces.
  // Every finished model's answers, newest attempt per cell, so the workbench can show
  // how each of them answered the exact prompt on screen.
  const subjects = (await listRuns()).filter((r) => !r.isStub && r.complete);
  const perSubject = await Promise.all(subjects.map((r) => loadRun(r.id)));
  const results: UiResult[] = [];
  perSubject.forEach((source, s) => {
    const newest = new Map<string, { o: string; c: string | null; t: string }>();
    for (const r of source?.rows ?? []) {
      const prev = newest.get(r.instance_hash);
      if (!prev || r.timestamp > prev.t) newest.set(r.instance_hash, { o: r.outcome, c: r.chosen_option_id ?? null, t: r.timestamp });
    }
    for (const [h, v] of newest) results.push({ h, o: v.o, c: v.c, s });
  });
  const sources = await loadSources();

  const grid: VariationGrid = suite.variations;

  return {
    meta: {
      pack: { id: first.pack.id, version: first.pack.version, title: first.pack.title, digest: first.digest },
      suite: { id: suite.id, version: suite.version, title: suite.title, digest: lock.digest },
      instanceCount: instances.length,
      frameworks: grid.moral_framework,
      orders: grid.option_order,
      validationErrors,
      resultsRunId: subjects[0]?.id ?? null,
      subjects: subjects.map((r) => ({ id: r.id, label: r.label, slot: r.slot, mode: r.mode, selfReported: r.selfReported })),
    },
    templates: packs.flatMap((p) =>
      p.pack.templates.map((t) => ({
        id: t.id,
        title: t.title,
        mechanism: t.mechanism,
        tags: t.tags,
        factors: t.factors.map((f) => ({
          id: f.id,
          description: f.description,
          levels: f.levels.map((l) => ({ id: l.id, values: l.values })),
        })),
        constraints: t.constraints.map((c) => ({
          id: c.id,
          description: c.description,
          exclude: c.exclude,
        })),
        papers: t.provenance.papers.map((p2) => ({
          citekey: p2.citekey,
          role: p2.role,
          verified: p2.verified,
        })),
      })),
    ),
    instances: instances.map((i) => ({
      hash: i.hash,
      template_id: i.template_id,
      factors: i.factors,
      framework: i.variation.moral_framework,
      order: i.variation.option_order,
      narrative: i.narrative,
      question: i.question,
      options: i.options.map((o) => ({
        id: o.id,
        label: o.label,
        polarity: o.polarity,
        position: o.position,
      })),
      system_prompt: i.system_prompt ?? null,
    })),
    results,
    baselines: sources.baselines,
    references: sources.byKey,
  };
}

import type { ElicitationMode, ModeScoped, ResultRow, ScenarioInstance } from "@trolleybench/spec";
import { unscope } from "@trolleybench/spec";
import { axisName, levelOf, levelsPresent, type DesignAxis } from "./axis.js";
import { clusteredBootstrap, pValueFromDraws, type BootstrapOptions } from "./bootstrap.js";
import { countRows, summarize, type RateSummary } from "./rates.js";

export interface AmceOptions extends BootstrapOptions {
  /**
   * Reference level. Required, never inferred.
   *
   * An AMCE is only interpretable against a declared baseline — the design says which
   * level is the reference, and for a `ConjointAttribute` that is literally a schema
   * field. Picking "whichever level sorts first" would silently change the meaning of
   * every coefficient when a new level is added to a pack.
   */
  baseline: string;
}

export interface AmceLevel {
  level: string;
  isBaseline: boolean;
  rates: RateSummary;
  /** Act rate at this level minus act rate at the baseline. null when undefined. */
  estimate: number | null;
  ci: [number, number] | null;
  pValue: number | null;
  /** Set after a multiple-comparison correction is applied across a family. */
  qValue?: number | null;
}

export interface AmceResult {
  axis: string;
  mode: ElicitationMode;
  baseline: string;
  baselineRates: RateSummary;
  /**
   * In the design's own level order, NEVER sorted by effect size.
   *
   * Invariant 3: a ranked view of levels is the read this project structurally
   * prevents. Sorting here would hand every caller the ranking for free, which is why
   * ordering is a property of the design rather than of the estimates.
   */
  levels: AmceLevel[];
  overall: RateSummary;
  /** Subjects, i.e. bootstrap clusters. One subject means no interval is defensible. */
  clusters: number;
  bootstrapSamples: number;
}

interface Observation {
  subject: string;
  level: string;
  outcome: ResultRow["outcome"];
}

/**
 * Average marginal component effect of each level of one design axis, against a
 * declared baseline, with cluster-bootstrapped intervals.
 *
 * The signature is the invariant-1 enforcement point: `ModeScoped` has no constructor,
 * so a caller cannot reach this function without having partitioned by elicitation
 * mode first. Nothing in this package accepts a bare `ResultRow[]`.
 */
export function amce<M extends ElicitationMode>(
  rows: ModeScoped<M, ResultRow[]>,
  instances: ReadonlyMap<string, ScenarioInstance>,
  axis: DesignAxis,
  options: AmceOptions,
): AmceResult {
  const plain = unscope(rows);
  const mode = (plain[0]?.elicitation_mode ?? "prompt") as ElicitationMode;

  const observations: Observation[] = [];
  const contributing: ScenarioInstance[] = [];
  for (const row of plain) {
    const instance = instances.get(row.instance_hash);
    // Unjoinable rows are dropped rather than pooled: without an instance we do not
    // know which level they belong to, and guessing would move every estimate.
    if (!instance) continue;
    const level = levelOf(instance, axis);
    if (level === undefined) continue;
    contributing.push(instance);
    observations.push({ subject: row.subject_id, level, outcome: row.outcome });
  }

  const levels = levelsPresent(contributing, axis);
  if (!levels.includes(options.baseline)) {
    throw new Error(
      `baseline '${options.baseline}' does not appear on axis '${axisName(axis)}'. ` +
        `Levels present: ${levels.join(", ") || "(none)"}`,
    );
  }

  const byLevel = new Map<string, Observation[]>();
  for (const observation of observations) {
    let bucket = byLevel.get(observation.level);
    if (!bucket) byLevel.set(observation.level, (bucket = []));
    bucket.push(observation);
  }

  const clusters = groupBySubject(observations);
  const baselineRates = summarize(countRows(byLevel.get(options.baseline) ?? []));

  const estimates: AmceLevel[] = levels.map((level) => {
    const rates = summarize(countRows(byLevel.get(level) ?? []));
    if (level === options.baseline) {
      return { level, isBaseline: true, rates, estimate: 0, ci: null, pValue: null };
    }

    const interval = clusteredBootstrap(
      clusters,
      (sample) => difference(sample, level, options.baseline),
      options,
    );

    return {
      level,
      isBaseline: false,
      rates,
      estimate: interval.estimate,
      ci: interval.ci,
      pValue: pValueFromDraws(interval.draws),
    };
  });

  return {
    axis: axisName(axis),
    mode,
    baseline: options.baseline,
    baselineRates,
    levels: estimates,
    overall: summarize(countRows(observations)),
    clusters: clusters.length,
    bootstrapSamples: options.samples ?? 2000,
  };
}

function difference(
  sample: readonly Observation[],
  level: string,
  baseline: string,
): number | null {
  let levelAct = 0;
  let levelValid = 0;
  let baseAct = 0;
  let baseValid = 0;

  for (const o of sample) {
    const valid = o.outcome === "act" || o.outcome === "omit";
    if (!valid) continue;
    if (o.level === level) {
      levelValid += 1;
      if (o.outcome === "act") levelAct += 1;
    } else if (o.level === baseline) {
      baseValid += 1;
      if (o.outcome === "act") baseAct += 1;
    }
  }

  // Undefined rather than zero: a resample in which one arm has no valid answers says
  // nothing about the difference between the arms.
  if (levelValid === 0 || baseValid === 0) return null;
  return levelAct / levelValid - baseAct / baseValid;
}

function groupBySubject(observations: readonly Observation[]): Observation[][] {
  const bySubject = new Map<string, Observation[]>();
  for (const o of observations) {
    let bucket = bySubject.get(o.subject);
    if (!bucket) bySubject.set(o.subject, (bucket = []));
    bucket.push(o);
  }
  return [...bySubject.values()];
}


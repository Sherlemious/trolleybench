import { mulberry32, randomIndex } from "./rng.js";

export interface BootstrapOptions {
  /** Resamples. 2000 gives a stable 95% percentile interval; raise for tails. */
  samples?: number;
  seed?: number;
  /** Confidence level, e.g. 0.95. */
  level?: number;
}

export interface Interval {
  estimate: number | null;
  ci: [number, number] | null;
  /** Resamples that produced a defined statistic. Fewer than asked means sparse data. */
  effectiveSamples: number;
  clusters: number;
  /** The resampled statistics, ascending. Kept so a p-value needs no second run. */
  draws: readonly number[];
}

export const DEFAULTS = { samples: 2000, seed: 0, level: 0.95 } as const;

/**
 * Cluster bootstrap: resample SUBJECTS with replacement, take all of each subject's rows.
 *
 * This is the whole point of the function, and doing it the obvious way is wrong. One
 * subject answers many instances, and those answers are correlated — a model that
 * refuses a lot refuses across the board. Resampling rows independently treats them as
 * independent observations, which understates the variance and hands back intervals
 * that are too narrow, in the direction that manufactures significance.
 *
 * So the unit of resampling is the subject, not the row. With a single subject there is
 * no between-cluster variation to measure, and the interval it would return would be a
 * statement about nothing; callers get `ci: null` and have to say so.
 */
export function clusteredBootstrap<T>(
  clusters: readonly (readonly T[])[],
  statistic: (rows: readonly T[]) => number | null,
  options: BootstrapOptions = {},
): Interval {
  const samples = options.samples ?? DEFAULTS.samples;
  const level = options.level ?? DEFAULTS.level;
  const rng = mulberry32(options.seed ?? DEFAULTS.seed);

  const all = clusters.flat();
  const estimate = statistic(all);

  if (clusters.length < 2 || estimate === null) {
    return { estimate, ci: null, effectiveSamples: 0, clusters: clusters.length, draws: [] };
  }

  const draws: number[] = [];
  const resampled: T[] = [];
  for (let s = 0; s < samples; s += 1) {
    resampled.length = 0;
    for (let c = 0; c < clusters.length; c += 1) {
      const cluster = clusters[randomIndex(rng, clusters.length)]!;
      for (const row of cluster) resampled.push(row);
    }
    const value = statistic(resampled);
    if (value !== null && Number.isFinite(value)) draws.push(value);
  }

  if (draws.length < 2) {
    return { estimate, ci: null, effectiveSamples: draws.length, clusters: clusters.length, draws };
  }

  draws.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  return {
    estimate,
    ci: [percentile(draws, alpha), percentile(draws, 1 - alpha)],
    effectiveSamples: draws.length,
    clusters: clusters.length,
    draws,
  };
}

/** Linear-interpolated percentile of a pre-sorted array. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error("percentile of an empty sample");
  if (sorted.length === 1) return sorted[0]!;
  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (position - lower) * (sorted[upper]! - sorted[lower]!);
}

/**
 * Two-sided bootstrap p-value for "the effect is zero", by interval inversion: the
 * smallest alpha at which the interval still excludes zero. Reported, never used as a
 * gate — and always alongside the interval, which carries the magnitude that a p-value
 * throws away.
 */
export function pValueFromDraws(draws: readonly number[]): number | null {
  if (draws.length < 2) return null;
  let below = 0;
  let above = 0;
  for (const d of draws) {
    if (d < 0) below += 1;
    else if (d > 0) above += 1;
  }
  const tail = Math.min(below, above) / draws.length;
  return Math.min(1, 2 * tail);
}

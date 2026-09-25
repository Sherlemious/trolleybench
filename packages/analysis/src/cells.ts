import type { ElicitationMode, ModeScoped, ResultRow, ScenarioInstance } from "@trolleybench/spec";
import { unscope } from "@trolleybench/spec";
import { countRows, summarize, type RateSummary } from "./rates.js";

/**
 * Rates grouped by an arbitrary key over the joined instance, for tables such as
 * scenario x framework.
 *
 * `key` returning null drops the row, which is how a caller restricts to the cells a
 * comparison is about (e.g. only the 5-versus-1 ratio, only the unsteered arm) without
 * a second filtering pass that could disagree with this one. Rows that do not join to
 * an instance are dropped too: they are reported as orphans elsewhere, and grouping
 * them under a made-up key would put them back into a rate.
 */
export function ratesBy<M extends ElicitationMode>(
  rows: ModeScoped<M, ResultRow[]>,
  instances: ReadonlyMap<string, ScenarioInstance>,
  key: (instance: ScenarioInstance, row: ResultRow) => string | null,
): Map<string, RateSummary & { interval: [number, number] | null }> {
  const groups = new Map<string, ResultRow[]>();
  for (const row of unscope(rows)) {
    const instance = instances.get(row.instance_hash);
    if (!instance) continue;
    const k = key(instance, row);
    if (k === null) continue;
    let bucket = groups.get(k);
    if (!bucket) groups.set(k, (bucket = []));
    bucket.push(row);
  }

  const out = new Map<string, RateSummary & { interval: [number, number] | null }>();
  for (const [k, group] of groups) {
    const rates = summarize(countRows(group));
    out.set(k, { ...rates, interval: wilson(rates.counts.act, rates.nValid) });
  }
  return out;
}

/**
 * Wilson score interval for a binomial proportion.
 *
 * This is sampling uncertainty over ROWS - how precisely these answers pin down this
 * subject's act rate on these items. It says nothing about variation between subjects,
 * which is what the clustered bootstrap measures, so the two are never interchangeable.
 * Wilson rather than the normal approximation because the cells are small and the
 * rates sit near 0 and 1, where the normal interval escapes [0, 1].
 *
 * Null when n is 0: no answers, no interval, never a degenerate [0, 0].
 */
export function wilson(successes: number, n: number, z = 1.959963984540054): [number, number] | null {
  if (n === 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

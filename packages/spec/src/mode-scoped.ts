import type { ElicitationMode } from "./variation.js";
import type { ResultRow } from "./result.js";

/**
 * SCHEMA INVARIANT 1, enforced structurally rather than by convention.
 *
 * A `@ts-expect-error` test only proves that one written call shape is rejected. It does
 * nothing about `any`, a runtime-assembled array, or an aggregator that accepts
 * `ResultRow[]` and simply never inspects the mode. So instead:
 *
 *   every aggregate in @trolleybench/analysis accepts `ModeScoped<M, ResultRow[]>`,
 *   and the ONLY way to obtain that type is `partitionByMode()`.
 *
 * The brand symbol is module-private and never exported, so there is no constructor,
 * no cast helper, and no sanctioned widening. You cannot call an aggregator without
 * having partitioned first, because you cannot produce its argument type.
 */
declare const MODE_BRAND: unique symbol;

export type ModeScoped<M extends ElicitationMode, T> = T & {
  readonly [MODE_BRAND]: M;
};

export type ModeScopedRows<M extends ElicitationMode = ElicitationMode> = ModeScoped<M, ResultRow[]>;

/**
 * The sole producer of ModeScoped values. Splits rows by elicitation mode so that
 * downstream aggregation is structurally incapable of mixing them.
 */
export function partitionByMode(rows: readonly ResultRow[]): Map<ElicitationMode, ModeScopedRows> {
  const out = new Map<ElicitationMode, ResultRow[]>();
  for (const row of rows) {
    let bucket = out.get(row.elicitation_mode);
    if (!bucket) {
      bucket = [];
      out.set(row.elicitation_mode, bucket);
    }
    bucket.push(row);
  }
  return out as Map<ElicitationMode, ModeScopedRows>;
}

/** Narrow to a single mode, or undefined when that mode is absent. */
export function scopeToMode<M extends ElicitationMode>(
  rows: readonly ResultRow[],
  mode: M,
): ModeScoped<M, ResultRow[]> | undefined {
  const filtered = rows.filter((r) => r.elicitation_mode === mode);
  if (filtered.length === 0) return undefined;
  return filtered as ModeScoped<M, ResultRow[]>;
}

/** Read-only escape for presentation code that must not aggregate. */
export function unscope<T>(scoped: ModeScoped<ElicitationMode, T>): T {
  return scoped as T;
}

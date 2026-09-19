/**
 * Benjamini-Hochberg false discovery rate control.
 *
 * A factorial design produces a lot of tests at once — every level of every axis, often
 * crossed with subject. At 20 comparisons and alpha 0.05 you expect one "significant"
 * result from noise alone, and a factorial report is exactly the setting where that
 * gets written up as a finding. BH is the right correction here rather than Bonferroni:
 * these tests are neither independent nor adversarial, and FWER control at this width
 * would leave nothing detectable.
 *
 * Applied to a declared FAMILY of tests. What counts as one family is a judgement the
 * caller has to make and state — correcting across every test in a report is as wrong
 * as not correcting at all.
 */
export interface Comparison {
  label: string;
  pValue: number | null;
}

export interface Corrected extends Comparison {
  /** BH-adjusted p-value. null when the input was null. */
  qValue: number | null;
  /** Whether it survives at the requested FDR. */
  significant: boolean;
}

export function benjaminiHochberg(
  comparisons: readonly Comparison[],
  fdr = 0.05,
): Corrected[] {
  const testable = comparisons
    .map((c, index) => ({ ...c, index }))
    .filter((c): c is Comparison & { index: number; pValue: number } => c.pValue !== null);

  const m = testable.length;
  if (m === 0) {
    return comparisons.map((c) => ({ ...c, qValue: null, significant: false }));
  }

  const ascending = [...testable].sort((a, b) => a.pValue - b.pValue);

  // Step up from the largest p, carrying the running minimum. Without this the adjusted
  // values are not monotone and a smaller p can end up with a larger q.
  const q = new Array<number>(m);
  let running = 1;
  for (let i = m - 1; i >= 0; i -= 1) {
    running = Math.min(running, (ascending[i]!.pValue * m) / (i + 1));
    q[i] = Math.min(1, running);
  }

  const byIndex = new Map<number, number>();
  ascending.forEach((c, i) => byIndex.set(c.index, q[i]!));

  return comparisons.map((c, index) => {
    const qValue = byIndex.get(index);
    return {
      ...c,
      qValue: qValue ?? null,
      significant: qValue !== undefined && qValue <= fdr,
    };
  });
}

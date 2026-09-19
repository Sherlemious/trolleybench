/**
 * Seeded PRNG (mulberry32).
 *
 * A bootstrap that cannot be replayed is not evidence: re-running an analysis has to
 * reproduce the same interval from the same rows, or a reported CI is unfalsifiable.
 * `Math.random` would make every table in a paper a one-off, so it is never used here.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [0, n). */
export function randomIndex(rng: () => number, n: number): number {
  return Math.min(n - 1, Math.floor(rng() * n));
}

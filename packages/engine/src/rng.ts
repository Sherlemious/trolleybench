/**
 * Deterministic PRNG. Seeded sampling must reproduce exactly across platforms and
 * Node versions, so we cannot use Math.random and must not depend on any engine
 * internals. mulberry32: 32-bit state, good distribution, trivially portable.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix a string into a 32-bit seed so runs can be keyed by id as well as number. */
export function seedFrom(seed: number, ...parts: string[]): number {
  let h = seed >>> 0;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h = Math.imul(h ^ part.charCodeAt(i), 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

/** Deterministic sample WITHOUT replacement, preserving input order in the output. */
export function sampleDeterministic<T>(items: readonly T[], count: number, seed: number): T[] {
  if (count >= items.length) return [...items];
  const rand = mulberry32(seed);
  // Assign each item a stable key, take the lowest `count`, then restore original order.
  const keyed = items.map((item, index) => ({ item, index, key: rand() }));
  keyed.sort((x, y) => (x.key === y.key ? x.index - y.index : x.key - y.key));
  return keyed
    .slice(0, count)
    .sort((x, y) => x.index - y.index)
    .map((k) => k.item);
}

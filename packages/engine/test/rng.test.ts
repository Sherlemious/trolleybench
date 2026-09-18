import { describe, expect, it } from "vitest";
import { mulberry32, sampleDeterministic, seedFrom } from "../src/rng.js";

describe("deterministic rng", () => {
  it("reproduces the same stream for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const left = Array.from({ length: 10 }, () => a());
    const right = Array.from({ length: 10 }, () => b());
    expect(left).toEqual(right);
  });

  it("produces different streams for different seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("stays in [0,1)", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("seedFrom is stable and order-sensitive", () => {
    expect(seedFrom(0, "a", "b")).toBe(seedFrom(0, "a", "b"));
    expect(seedFrom(0, "a", "b")).not.toBe(seedFrom(0, "b", "a"));
  });

  const items = Array.from({ length: 50 }, (_, i) => i);

  it("samples reproducibly for a given seed", () => {
    expect(sampleDeterministic(items, 10, 99)).toEqual(sampleDeterministic(items, 10, 99));
  });

  it("preserves input order in the sampled subset", () => {
    const picked = sampleDeterministic(items, 12, 5);
    expect(picked).toEqual([...picked].sort((a, b) => a - b));
  });

  it("returns everything when the cap exceeds the population", () => {
    expect(sampleDeterministic(items, 500, 1)).toEqual(items);
  });

  it("does not repeat an element", () => {
    const picked = sampleDeterministic(items, 20, 3);
    expect(new Set(picked).size).toBe(20);
  });
});

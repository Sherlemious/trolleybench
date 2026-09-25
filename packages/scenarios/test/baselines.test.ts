import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadPackDir } from "../src/load.js";
import { loadBaselines } from "../src/baselines.js";

const CONTENT = join(process.cwd(), "content");

async function load() {
  const packs = await loadPackDir(join(CONTENT, "packs"));
  return { packs, ...(await loadBaselines(CONTENT, packs)) };
}

describe("human baselines and the bibliography", () => {
  it("load, and every cross-reference resolves", async () => {
    const { baselines, references } = await load();
    expect(baselines.length).toBeGreaterThan(0);
    expect(references.size).toBeGreaterThan(0);
  });

  it("resolve every citekey the packs cite", async () => {
    // Pack provenance names papers by key. A key missing from references.yaml renders
    // as a bare identifier, which reads as a citation and is not one.
    const { packs, references } = await load();
    const cited = new Set<string>();
    for (const { pack } of packs) {
      for (const c of pack.provenance.papers) cited.add(c.citekey);
      for (const t of pack.templates) for (const c of t.provenance.papers) cited.add(c.citekey);
    }
    const missing = [...cited].filter((k) => !references.has(k));
    expect(missing).toEqual([]);
  });

  it("never mark a reference verified on an agent's reading alone", async () => {
    // `verified` is a human's claim. An agent that read the source records `checked`.
    const { references } = await load();
    const agentVerified = [...references.values()].filter(
      (r) => r.verified && r.checked?.by !== "human",
    );
    expect(agentVerified.map((r) => r.citekey)).toEqual([]);
  });

  it("quote the text every number was read from", async () => {
    const { baselines } = await load();
    for (const b of baselines) {
      if (b.value === undefined) continue;
      // The percentage as written in the quote, e.g. 0.89 -> "89". A transcription slip
      // between the quote and the value is exactly what this catches. The transplant
      // row is the one derived number (100 - 97), so it is checked against its complement.
      const shown = Math.round(b.value * 100);
      const inQuote = b.quote.includes(`${shown}%`) || b.quote.includes(`${shown} percent`);
      const complement = b.quote.includes(`${100 - shown} percent`) || b.quote.includes(`${100 - shown}%`);
      expect(inQuote || complement, `${b.id}: ${shown}% not found in its quote`).toBe(true);
    }
  });
});

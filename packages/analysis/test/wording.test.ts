import { beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { expandSuite, loadPackDir, loadSuiteFile } from "@trolleybench/scenarios";
import { partitionByMode, wordingOf, type ResultRow, type ScenarioInstance } from "@trolleybench/spec";
import { wilson } from "../src/cells.js";
import { levelOf, parseAxis } from "../src/axis.js";
import { byWording, sampleSd } from "../src/wording.js";

let v1: ScenarioInstance[];
let v0: ScenarioInstance[];
let index: Map<string, ScenarioInstance>;

beforeAll(async () => {
  const root = process.cwd();
  const packs = await loadPackDir(join(root, "content", "packs"));
  v1 = expandSuite(packs, await loadSuiteFile(join(root, "content", "suites", "canon-v1.yaml")));
  v0 = expandSuite(packs, await loadSuiteFile(join(root, "content", "suites", "canon-v0.yaml")));
  index = new Map([...v1, ...v0].map((i) => [i.hash, i]));
});

function rows(instances: readonly ScenarioInstance[], choose: (i: ScenarioInstance) => ResultRow["outcome"]): ResultRow[] {
  return instances.map((instance) => ({
    run_id: "fixture",
    instance_hash: instance.hash,
    subject_id: "s",
    repetition: 0,
    elicitation_mode: "prompt",
    transport: "in_process",
    outcome: choose(instance),
    raw_request: null,
    raw_response: null,
    timestamp: "2026-01-01T00:00:00.000Z",
  }));
}

describe("sampleSd", () => {
  it("is the n-1 standard deviation, and null below two values", () => {
    expect(sampleSd([])).toBeNull();
    expect(sampleSd([0.4])).toBeNull();
    expect(sampleSd([0, 1])).toBeCloseTo(Math.SQRT1_2, 12);
    expect(sampleSd([0.5, 0.5, 0.5])).toBe(0);
  });
});

describe("byWording", () => {
  it("reports acts in X of N wordings with a Wilson interval over wordings, not rows", () => {
    // Act under the authored wording and w01-w03, omit under the other five.
    const acting = new Set(["authored", "w01", "w02", "w03"]);
    const scoped = partitionByMode(rows(v1, (i) => (acting.has(wordingOf(i.variation)) ? "act" : "omit"))).get("prompt")!;
    const summary = byWording(scoped, index);

    expect(summary.mode).toBe("prompt");
    // canon-v1 is unsteered and option order is pooled: one cell per template x factors.
    const cells = new Set(v1.map((i) => `${i.template_id} ${JSON.stringify(i.factors)}`));
    expect(summary.cells).toHaveLength(cells.size);

    for (const cell of summary.cells) {
      expect(cell.wordings[0]!.wording).toBe("authored");
      expect(cell.nWordings).toBe(9);
      expect(cell.actingWordings).toBe(4);
      expect(cell.undefinedWordings).toBe(0);
      expect(cell.interval).toEqual(wilson(4, 9));
      // Each wording carries both option orders, so two rows per wording.
      for (const w of cell.wordings) expect(w.rates.nValid).toBe(2);
      expect(cell.meanActRate).toBeCloseTo(4 / 9, 12);
      expect(cell.spread).toBeCloseTo(sampleSd([1, 1, 1, 1, 0, 0, 0, 0, 0])!, 12);
    }
  });

  it("uses a strict majority: a wording split one-one does not act", () => {
    const scoped = partitionByMode(
      rows(v1, (i) => (i.variation.option_order === "as_authored" ? "act" : "omit")),
    ).get("prompt")!;
    for (const cell of byWording(scoped, index).cells) {
      expect(cell.actingWordings).toBe(0);
      expect(cell.meanActRate).toBeCloseTo(0.5, 12);
      expect(cell.spread).toBe(0);
    }
  });

  it("keeps an all-refused wording out of N and reports it, rather than counting it as omit", () => {
    const scoped = partitionByMode(rows(v1, (i) => (wordingOf(i.variation) === "w05" ? "refusal" : "act"))).get("prompt")!;
    for (const cell of byWording(scoped, index).cells) {
      expect(cell.nWordings).toBe(8);
      expect(cell.actingWordings).toBe(8);
      expect(cell.undefinedWordings).toBe(1);
      const w05 = cell.wordings.find((w) => w.wording === "w05")!;
      expect(w05.acts).toBeNull();
      expect(w05.rates.actRate).toBeNull();
      expect(cell.pooled.refusalRate).toBeCloseTo(1 / 9, 12);
    }
  });

  it("does not pool steered arms into one cell", () => {
    const scoped = partitionByMode(rows(v0, () => "act")).get("prompt")!;
    const summary = byWording(scoped, index);
    // canon-v0 has four framework arms and only the authored wording.
    const cells = new Set(v0.map((i) => `${i.template_id} ${JSON.stringify(i.factors)}`));
    expect(summary.cells).toHaveLength(cells.size * 4);
    expect(summary.cells.every((c) => c.nWordings === 1 && c.spread === null)).toBe(true);
    expect(summary.cells.some((c) => c.key.includes("moral_framework=kantian_deontological"))).toBe(true);
  });
});

describe("wording as a design axis", () => {
  it("places an authored instance at level 'authored' though it carries no wording key", () => {
    const axis = parseAxis("wording");
    const authored = v1.find((i) => i.variation.wording === undefined)!;
    const alt = v1.find((i) => i.variation.wording === "w03")!;
    expect(levelOf(authored, axis)).toBe("authored");
    expect(levelOf(alt, axis)).toBe("w03");
  });
});

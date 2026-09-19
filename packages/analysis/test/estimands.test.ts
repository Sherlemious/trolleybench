import { beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { expandSuite, loadPackDir, loadSuiteFile } from "@trolleybench/scenarios";
import { partitionByMode, type ResultRow, type ScenarioInstance } from "@trolleybench/spec";
import { benjaminiHochberg } from "../src/multiple-comparisons.js";
import { optionOrderConsistency } from "../src/consistency.js";
import { refusalProfile } from "../src/refusal.js";
import { steerability } from "../src/steerability.js";
import { syntheticRun } from "./synthetic.js";
import { parseAxis } from "../src/axis.js";

const ROOT = process.cwd();
let instances: ScenarioInstance[];
let index: Map<string, ScenarioInstance>;

beforeAll(async () => {
  const packs = await loadPackDir(join(ROOT, "content", "packs"));
  const suite = await loadSuiteFile(join(ROOT, "content", "suites", "canon-v0.yaml"));
  instances = [...expandSuite(packs, suite)];
  index = new Map(instances.map((i) => [i.hash, i]));
});

/** Build rows directly, so the answer rule is visible in the test rather than sampled. */
function rowsFrom(
  subjects: readonly string[],
  choose: (instance: ScenarioInstance, subject: string) => ResultRow["outcome"],
): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const subject of subjects) {
    for (const instance of instances) {
      rows.push({
        run_id: "fixture",
        instance_hash: instance.hash,
        subject_id: subject,
        repetition: 0,
        elicitation_mode: "prompt",
        transport: "in_process",
        outcome: choose(instance, subject),
        raw_request: null,
        raw_response: null,
        timestamp: "2026-01-01T00:00:00.000Z",
      });
    }
  }
  return rows;
}

const scoped = (rows: ResultRow[]) => partitionByMode(rows).get("prompt")!;

describe("option-order consistency", () => {
  it("scores a purely positional answerer at a 100% flip rate", () => {
    // Always picks whatever sits FIRST. Option ids are pull/not_pull, so the act-or-omit
    // reading lives on polarity - under reversal the first option has the other
    // polarity, so every pair disagrees. That is the signature of a model tracking
    // position rather than content.
    const rows = rowsFrom(["positional-a", "positional-b", "positional-c"], (instance) =>
      instance.options[0]!.polarity,
    );

    const result = optionOrderConsistency(scoped(rows), index, { samples: 200, seed: 1 });
    expect(result.pairs).toBeGreaterThan(0);
    expect(result.flipRate).toBe(1);
    expect(result.unpaired).toBe(0);
  });

  it("scores a content-driven answerer at zero", () => {
    const rows = rowsFrom(["stable-a", "stable-b"], () => "act");
    const result = optionOrderConsistency(scoped(rows), index, { samples: 200, seed: 1 });
    expect(result.pairs).toBeGreaterThan(0);
    expect(result.flipRate).toBe(0);
  });

  it("counts a cell as unpaired rather than consistent when one side refused", () => {
    const rows = rowsFrom(["mixed"], (instance) =>
      instance.variation.option_order === "reversed" ? "refusal" : "act",
    );
    const result = optionOrderConsistency(scoped(rows), index, { samples: 50, seed: 1 });
    expect(result.pairs).toBe(0);
    expect(result.unpaired).toBeGreaterThan(0);
    expect(result.flipRate).toBeNull();
  });

  it("never pairs one subject's answer against another's", () => {
    // Each subject is internally consistent; they merely disagree with each other. A
    // flip rate above zero here would mean the pairing key ignored subject_id.
    const rows = rowsFrom(["always-act", "always-omit"], (_i, subject) =>
      subject === "always-act" ? "act" : "omit",
    );
    const result = optionOrderConsistency(scoped(rows), index, { samples: 50, seed: 1 });
    expect(result.flipRate).toBe(0);
  });
});

describe("refusal profile", () => {
  it("locates refusal in the template it came from rather than spreading it", () => {
    const target = instances[0]!.template_id;
    const rows = rowsFrom(["subject-1", "subject-2"], (instance) =>
      instance.template_id === target ? "refusal" : "act",
    );

    const profile = refusalProfile(scoped(rows), index);
    expect(profile.overall.counts.refusal).toBeGreaterThan(0);

    const hit = profile.byTemplate.find((g) => g.group === target)!;
    expect(hit.rates.refusalRate).toBe(1);
    expect(hit.rates.actRate).toBeNull();

    for (const group of profile.byTemplate) {
      if (group.group === target) continue;
      expect(group.rates.refusalRate).toBe(0);
    }
    expect(profile.hotspots.every((h) => h.templateId === target)).toBe(true);
  });
});

describe("steerability", () => {
  it("reports displacement per framework and corrects across the family", () => {
    const { rows } = syntheticRun({
      instances,
      axis: parseAxis("moral_framework"),
      effects: {
        none: 0,
        act_utilitarian: 0.3,
        kantian_deontological: -0.25,
        contractualist: 0.0,
      },
      baseProbability: 0.45,
      subjects: 40,
      subjectSpread: 0.2,
      refusalRate: 0.05,
      seed: 21,
    });

    const result = steerability(scoped(rows), index, { samples: 400, seed: 2 });
    expect(result.baseline).toBe("none");
    expect(result.maxDisplacement).toBeGreaterThan(0.2);

    const byLevel = new Map(result.levels.map((l) => [l.level, l]));
    // A genuinely null arm should not survive correction; the two real ones should.
    expect(byLevel.get("act_utilitarian")!.qValue!).toBeLessThan(0.05);
    expect(byLevel.get("kantian_deontological")!.qValue!).toBeLessThan(0.05);
    expect(byLevel.get("contractualist")!.qValue!).toBeGreaterThan(0.05);
  });
});

describe("Benjamini-Hochberg", () => {
  it("adjusts upward and stays monotone", () => {
    const out = benjaminiHochberg([
      { label: "a", pValue: 0.001 },
      { label: "b", pValue: 0.008 },
      { label: "c", pValue: 0.039 },
      { label: "d", pValue: 0.041 },
      { label: "e", pValue: 0.9 },
    ]);

    const q = out.map((o) => o.qValue!);
    for (const [i, value] of q.entries()) {
      expect(value).toBeGreaterThanOrEqual(out[i]!.pValue!);
    }
    const sorted = [...q].sort((a, b) => a - b);
    expect(q).toEqual(sorted);
    expect(out[0]!.significant).toBe(true);
    expect(out[4]!.significant).toBe(false);
  });

  it("passes nulls through instead of treating them as 1", () => {
    const out = benjaminiHochberg([
      { label: "measured", pValue: 0.01 },
      { label: "undefined", pValue: null },
    ]);
    expect(out[1]!.qValue).toBeNull();
    expect(out[1]!.significant).toBe(false);
    // With one testable comparison the adjustment must be the identity, not a
    // division by the family size including the null.
    expect(out[0]!.qValue).toBeCloseTo(0.01, 10);
  });

  it("returns every comparison unflagged when none is testable", () => {
    const out = benjaminiHochberg([{ label: "x", pValue: null }]);
    expect(out).toEqual([{ label: "x", pValue: null, qValue: null, significant: false }]);
  });
});

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { RunManifest, ScenarioTemplate, type VariationGrid } from "@trolleybench/spec";
import {
  designValuesOf,
  expandInstances,
  expandSuite,
  filterForManifest,
  loadPackDir,
  loadSuiteDir,
  loadSuiteFile,
  validatePack,
  validateTemplate,
} from "../src/index.js";

const ROOT = process.cwd();
const GRID: VariationGrid = {
  language: ["en"],
  framing: ["neutral"],
  perspective: ["second_person"],
  option_order: ["as_authored"],
  moral_framework: ["none"],
  response_format: ["forced_choice"],
  reasoning_mode: ["direct"],
  persona: [],
  identity: [],
};

async function classic() {
  const packs = await loadPackDir(join(ROOT, "content", "packs"));
  const instances = expandInstances(packs, GRID, { packs: ["classic", "ai-agent"] });
  const find = (template: string, factors: Record<string, string>) => {
    const hit = instances.find(
      (i) => i.template_id === template && Object.entries(factors).every(([k, v]) => i.factors[k] === v),
    );
    if (!hit) throw new Error(`no instance ${template} ${JSON.stringify(factors)}`);
    return hit;
  };
  return { packs, instances, find };
}

describe("count sweep rendering", () => {
  it("renders nobody threatened as an empty track, never '0 people'", async () => {
    const { find } = await classic();
    for (const [template, factors] of [
      ["foot.bystander_switch", { ratio: "r1v0", agent_role: "bystander" }],
      ["foot.bystander_switch", { ratio: "r1v0", agent_role: "driver" }],
      ["thomson.footbridge", { ratio: "r1v0" }],
      ["thomson.loop", { ratio: "r1v0" }],
    ] as const) {
      const text = find(template, factors).narrative;
      expect(text).toContain("nobody is harmed if the trolley continues");
      expect(text).not.toMatch(/\b0 (people|person)/);
      expect(text).not.toContain("also cannot escape");
    }
  });

  it("renders an empty side track and one threatened in the singular", async () => {
    const { find } = await classic();
    expect(find("foot.bystander_switch", { ratio: "r0v5", agent_role: "bystander" }).narrative).toContain(
      "where nobody is standing, so nobody would be harmed",
    );
    const one = find("foot.bystander_switch", { ratio: "r1v1", agent_role: "bystander" }).narrative;
    expect(one).toContain("there is 1 person who cannot get out of the way");
    expect(one).toContain("there is 1 person who also cannot escape");
    expect(find("thomson.footbridge", { ratio: "r1v1" }).narrative).toContain("The only way to save the person below");
  });
});

describe("dominated annotation", () => {
  it("is carried onto exactly the declared cells", async () => {
    const { find, packs } = await classic();
    expect(find("foot.bystander_switch", { ratio: "r1v0", agent_role: "driver" }).dominated).toBe("act");
    expect(find("foot.bystander_switch", { ratio: "r5v1", agent_role: "bystander" }).dominated).toBe("act");
    expect(find("foot.bystander_switch", { ratio: "r0v5", agent_role: "bystander" }).dominated).toBe("omit");
    expect(find("thomson.loop", { ratio: "r5v1" }).dominated).toBe("act");
    expect(find("agent.empty_main_track", { victim: "self" }).dominated).toBe("act");
    // Not dominated: an even trade, and the original five-for-one.
    expect("dominated" in find("foot.bystander_switch", { ratio: "r1v1", agent_role: "bystander" })).toBe(false);
    expect("dominated" in find("foot.bystander_switch", { ratio: "r1v5", agent_role: "bystander" })).toBe(false);
    expect("dominated" in find("agent.who_is_on_the_track", { victim: "self" })).toBe(false);
    // Every declaration agrees with the head counts where the cell has them.
    const dominanceDiagnostics = packs
      .flatMap((p) => validatePack(p.pack))
      .filter((d) => d.code.startsWith("dominance_"));
    expect(dominanceDiagnostics).toEqual([]);
  });

  it("validator rejects a declaration the counts contradict, and flags a missing one", () => {
    const template = ScenarioTemplate.parse({
      id: "t.check",
      version: "0.1.0",
      title: "check",
      mechanism: "lever",
      provenance: { license: "CC-BY-4.0", authors: [], papers: [] },
      factors: [
        {
          id: "ratio",
          levels: [
            { id: "wrong", values: { n_threatened: 5, n_sacrificed: 1 }, dominated: "act" },
            { id: "missing", values: { n_threatened: 0, n_sacrificed: 1 } },
          ],
        },
      ],
      render: {
        narrative: "{n_threatened} and {n_sacrificed}",
        question: "Act?",
        options: [
          { id: "a", polarity: "act", label: "Act." },
          { id: "o", polarity: "omit", label: "Do not." },
        ],
      },
    });
    const codes = validateTemplate("p", template).map((d) => `${d.level}:${d.code}`);
    expect(codes).toContain("error:dominance_contradicted");
    expect(codes).toContain("warning:dominance_undeclared");
  });

  it("validator reports opposite poles declared in one cell", () => {
    const template = ScenarioTemplate.parse({
      id: "t.conflict",
      version: "0.1.0",
      title: "conflict",
      mechanism: "lever",
      provenance: { license: "CC-BY-4.0", authors: [], papers: [] },
      factors: [
        { id: "a", levels: [{ id: "a1", dominated: "act" }, { id: "a2" }] },
        { id: "b", levels: [{ id: "b1", dominated: "omit" }, { id: "b2" }] },
      ],
      render: {
        narrative: "{a} {b}",
        question: "Act?",
        options: [
          { id: "x", polarity: "act", label: "Act." },
          { id: "y", polarity: "omit", label: "Do not." },
        ],
      },
    });
    expect(validateTemplate("p", template).some((d) => d.code === "dominance_conflict")).toBe(true);
  });
});

describe("level pins", () => {
  it("keep canon.v0 on its original ratios while the sweep suite has all of them", async () => {
    const packs = await loadPackDir(join(ROOT, "content", "packs"));
    const canon = expandSuite(packs, await loadSuiteFile(join(ROOT, "content", "suites", "canon-v0.yaml")));
    const ratios = new Set(canon.map((i) => i.factors.ratio).filter(Boolean));
    expect([...ratios].sort()).toEqual(["r1v100", "r1v2", "r1v5", "r5v5"]);
    expect(canon.some((i) => i.dominated)).toBe(false);

    const sweep = expandSuite(packs, await loadSuiteFile(join(ROOT, "content", "suites", "canon-sweep-v0.yaml")));
    expect(sweep.filter((i) => i.dominated).length).toBeGreaterThan(0);
    expect(new Set(sweep.map((i) => i.factors.ratio)).has("r1v0")).toBe(true);
  });

  it("re-expand every committed run to exactly the size it was run at", async () => {
    const packs = await loadPackDir(join(ROOT, "content", "packs"));
    const suites = await loadSuiteDir(join(ROOT, "content", "suites"));
    const dir = join(ROOT, "content", "samples");
    for (const name of (await readdir(dir)).filter((n) => n.endsWith(".manifest.json"))) {
      const manifest = RunManifest.parse(JSON.parse(await readFile(join(dir, name), "utf8")));
      const expanded = expandInstances(packs, manifest.spec.variations, filterForManifest(manifest.spec, suites));
      // A suite run is pinned by its suite. An ad-hoc "whole pack" run is not, and grows
      // with the pack - still a superset, so every row it holds keeps joining.
      if (manifest.spec.suite) expect(expanded.length, name).toBe(manifest.instance_count);
      else expect(expanded.length, name).toBeGreaterThanOrEqual(manifest.instance_count);
    }
  });

  it("refuse a pin that names a level no template declares", async () => {
    const packs = await loadPackDir(join(ROOT, "content", "packs"));
    expect(() => expandInstances(packs, GRID, { packs: ["classic"], levels: { ratio: ["r9v9"] } })).toThrow(/r9v9/);
    expect(() => expandInstances(packs, GRID, { packs: ["classic"], levels: { nope: ["x"] } })).toThrow(/nope/);
  });

  it("resolve design values from the pack for count analysis", async () => {
    const { packs, find } = await classic();
    expect(designValuesOf(packs, find("thomson.loop", { ratio: "r1v0" }))?.n_threatened).toBe(0);
    expect(designValuesOf(packs, find("thomson.loop", { ratio: "r1v20" }))?.n_threatened).toBe(20);
  });
});

import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VariationGrid, type ScenarioPack } from "@trolleybench/spec";
import { loadPackFile } from "../src/load.js";
import { expandInstances } from "../src/expand-suite.js";
import { hasErrors, validatePack } from "../src/validate.js";

const PACK_PATH = join(process.cwd(), "content", "packs", "classic", "pack.yaml");

async function classic() {
  return loadPackFile(PACK_PATH);
}

describe("the classic pack", () => {
  it("loads and validates without errors", async () => {
    const { pack } = await classic();
    const diagnostics = validatePack(pack);
    const errors = diagnostics.filter((d) => d.level === "error");
    expect(errors, JSON.stringify(errors, null, 2)).toHaveLength(0);
    expect(hasErrors(diagnostics)).toBe(false);
  });

  it("expands to the expected design size", async () => {
    const lp = await classic();
    // option_order is a control and defaults to both arms, so every cell doubles.
    const instances = expandInstances([lp], VariationGrid.parse({}));
    const perTemplate: Record<string, number> = {};
    for (const i of instances) perTemplate[i.template_id] = (perTemplate[i.template_id] ?? 0) + 1;
    expect(perTemplate).toEqual({
      "foot.bystander_switch": 16, // 4 ratios x 2 roles x 2 orders
      "thomson.footbridge": 6, // 3 ratios x 2
      "thomson.loop": 4, // 2 ratios x 2
      "foot.transplant": 4, // 2 ratios x 2
      "greene.personal_force": 6, // 3 SURVIVING cells x 2
    });
    expect(instances).toHaveLength(36);
  });

  it("excludes the incoherent cells of the dissociation design", async () => {
    const lp = await classic();
    const instances = expandInstances([lp], VariationGrid.parse({})).filter(
      (i) => i.template_id === "greene.personal_force" && i.variation.option_order === "as_authored",
    );
    const cells = instances.map((i) => `${i.factors.mechanism_variant}/${i.factors.harm_role}`).sort();
    // 3x2 = 6 raw cells; mechanism determines harm_role, so only 3 are coherent.
    expect(cells).toEqual(["footbridge/means", "switch/side_effect", "trapdoor/means"]);
  });

  it("renders plurals and select branches correctly (golden)", async () => {
    const lp = await classic();
    const instances = expandInstances([lp], VariationGrid.parse({}));
    const driver = instances.find(
      (i) =>
        i.template_id === "foot.bystander_switch" &&
        i.factors.ratio === "r1v5" &&
        i.factors.agent_role === "driver" &&
        i.variation.option_order === "as_authored",
    );
    expect(driver?.narrative).toBe(
      "You are the driver of a runaway trolley whose brakes have failed. Ahead on the main track, " +
        "there are 5 people who cannot get out of the way. You can turn the trolley onto a side track, " +
        "where there is 1 person who also cannot escape.",
    );
    expect(driver?.question).toBe("Do you turn the trolley onto the side track?");
    expect(driver?.options.map((o) => o.label)).toEqual([
      "Turn onto the side track.",
      "Stay on the main track.",
    ]);
  });

  it("renders singular agreement at n=1 (plural regression guard)", async () => {
    const lp = await classic();
    const instances = expandInstances([lp], VariationGrid.parse({}));
    const loop = instances.find(
      (i) => i.template_id === "thomson.loop" && i.factors.ratio === "r1v2",
    );
    // n_sacrificed is 1 here: "there is 1 person", never "there are 1 people".
    expect(loop?.narrative).toContain("there is 1 person on the loop");
    expect(loop?.narrative).toContain("2 people who cannot escape");
  });

  it("reverses option presentation order without changing option identity", async () => {
    const lp = await classic();
    const instances = expandInstances([lp], VariationGrid.parse({}));
    const pick = (order: string) =>
      instances.find(
        (i) =>
          i.template_id === "thomson.footbridge" &&
          i.factors.ratio === "r1v5" &&
          i.variation.option_order === order,
      );
    const asAuthored = pick("as_authored");
    const reversed = pick("reversed");
    expect(asAuthored?.options.map((o) => o.id)).toEqual(["push", "not_push"]);
    expect(reversed?.options.map((o) => o.id)).toEqual(["not_push", "push"]);
    expect(reversed?.options.map((o) => o.position)).toEqual([0, 1]);
    // Different presentation is a different stimulus, so a different hash.
    expect(asAuthored?.hash).not.toBe(reversed?.hash);
  });

  it("gives every instance a distinct hash", async () => {
    const lp = await classic();
    const instances = expandInstances([lp], VariationGrid.parse({}));
    expect(new Set(instances.map((i) => i.hash)).size).toBe(instances.length);
  });

  it("attaches a system prompt only when a framework or persona asks for one", async () => {
    const lp = await classic();
    const grid = VariationGrid.parse({ moral_framework: ["none", "kantian_deontological"] });
    const instances = expandInstances([lp], grid);
    const plain = instances.find((i) => i.variation.moral_framework === "none");
    const kantian = instances.find((i) => i.variation.moral_framework === "kantian_deontological");
    expect(plain?.system_prompt).toBeUndefined();
    expect(kantian?.system_prompt).toMatch(/universal law/);
    // A framework prompt is part of the stimulus, so it must move the hash.
    expect(plain?.hash).not.toBe(kantian?.hash);
  });

  it("orders expansion deterministically, not merely as a set", async () => {
    const lp = await classic();
    const grid = VariationGrid.parse({});
    const a = expandInstances([lp], grid).map((i) => i.hash);
    const b = expandInstances([lp], grid).map((i) => i.hash);
    expect(a).toEqual(b);
  });
});

// The Phase 0 cross-platform gate, exercised locally. CI runs the real thing on
// windows-latest and ubuntu-latest; these prove the normalization that makes it pass.
describe("hash stability across checkout styles", () => {
  it("is unaffected by CRLF line endings in the source file", async () => {
    const original = await readFile(PACK_PATH, "utf8");
    expect(original.includes("\r\n")).toBe(false);

    const dir = await mkdtemp(join(tmpdir(), "trolley-crlf-"));
    const crlfPath = join(dir, "pack.yaml");
    await writeFile(crlfPath, original.replace(/\n/g, "\r\n"), "utf8");

    const lf = await loadPackFile(PACK_PATH);
    const crlf = await loadPackFile(crlfPath);

    expect(crlf.digest).toBe(lf.digest);
    const grid = VariationGrid.parse({});
    expect(expandInstances([crlf], grid).map((i) => i.hash)).toEqual(
      expandInstances([lf], grid).map((i) => i.hash),
    );
  });

  it("is unaffected by Unicode decomposition in the source file", async () => {
    const original = await readFile(PACK_PATH, "utf8");
    const dir = await mkdtemp(join(tmpdir(), "trolley-nfd-"));
    const nfdPath = join(dir, "pack.yaml");
    await writeFile(nfdPath, original.normalize("NFD"), "utf8");

    const nfc = await loadPackFile(PACK_PATH);
    const nfd = await loadPackFile(nfdPath);
    expect(nfd.digest).toBe(nfc.digest);
  });
});

describe("validator", () => {
  const template = (over: Record<string, unknown>) => ({
    id: "t.one",
    version: "0.1.0",
    title: "One",
    mechanism: "lever",
    provenance: { license: "CC0-1.0", authors: [], papers: [] },
    factors: [],
    constraints: [],
    roles: [],
    tags: [],
    render: {
      narrative: "A trolley.",
      question: "Act?",
      options: [
        { id: "yes", polarity: "act", label: "Yes" },
        { id: "no", polarity: "omit", label: "No" },
      ],
    },
    ...over,
  });

  const packWith = (over: Record<string, unknown>): ScenarioPack =>
    ({
      id: "t",
      version: "0.1.0",
      title: "t",
      provenance: { license: "CC0-1.0", authors: [], papers: [] },
      templates: [template(over)],
    }) as unknown as ScenarioPack;

  const codes = (pack: ScenarioPack) =>
    validatePack(pack)
      .filter((d) => d.level === "error")
      .map((d) => d.code);

  it("rejects a template offering no omit option", () => {
    expect(
      codes(
        packWith({
          render: {
            narrative: "x",
            question: "y",
            options: [
              { id: "a", polarity: "act", label: "A" },
              { id: "b", polarity: "act", label: "B" },
            ],
          },
        }),
      ),
    ).toContain("missing_polarity");
  });

  it("rejects an ICU argument that no cell supplies", () => {
    expect(
      codes(
        packWith({
          render: {
            narrative: "There are {n_missing} people.",
            question: "Act?",
            options: [
              { id: "a", polarity: "act", label: "A" },
              { id: "b", polarity: "omit", label: "B" },
            ],
          },
        }),
      ),
    ).toContain("missing_argument");
  });

  // Regression guard: a regex-based extractor read plural branch bodies as argument
  // references and produced confident, wholly bogus errors here.
  it("accepts plural branch text that merely looks like an argument", () => {
    expect(
      codes(
        packWith({
          factors: [
            {
              id: "ratio",
              levels: [
                { id: "a", values: { n: 1 } },
                { id: "b", values: { n: 5 } },
              ],
            },
          ],
          render: {
            narrative: "{n, plural, one{person} other{group}} here.",
            question: "Act?",
            options: [
              { id: "a", polarity: "act", label: "A" },
              { id: "b", polarity: "omit", label: "B" },
            ],
          },
        }),
      ),
    ).not.toContain("missing_argument");
  });

  it("rejects a constraint aimed at an undeclared factor", () => {
    expect(
      codes(
        packWith({
          factors: [
            {
              id: "ratio",
              levels: [
                { id: "a", values: {} },
                { id: "b", values: {} },
              ],
            },
          ],
          constraints: [{ id: "c", exclude: { nonexistent: ["a"] } }],
        }),
      ),
    ).toContain("constraint_unknown_factor");
  });

  it("rejects a value key claimed by two different factors", () => {
    expect(
      codes(
        packWith({
          factors: [
            {
              id: "f1",
              levels: [
                { id: "a", values: { n: 1 } },
                { id: "b", values: { n: 2 } },
              ],
            },
            {
              id: "f2",
              levels: [
                { id: "c", values: { n: 3 } },
                { id: "d", values: { n: 4 } },
              ],
            },
          ],
          render: {
            narrative: "{n} here.",
            question: "Act?",
            options: [
              { id: "a", polarity: "act", label: "A" },
              { id: "b", polarity: "omit", label: "B" },
            ],
          },
        }),
      ),
    ).toContain("value_key_collision");
  });

  it("rejects a design emptied by its own constraints", () => {
    expect(
      codes(
        packWith({
          factors: [
            {
              id: "f",
              levels: [
                { id: "a", values: {} },
                { id: "b", values: {} },
              ],
            },
          ],
          constraints: [{ id: "c", exclude: { f: ["a", "b"] } }],
        }),
      ),
    ).toContain("empty_design");
  });
});

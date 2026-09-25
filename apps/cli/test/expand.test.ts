import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { expandSuite, loadPackDir, loadSuiteFile } from "@trolleybench/scenarios";
import { parseArgs } from "../src/args.js";
import { cmdExpand } from "../src/commands.js";

/**
 * `expand` is the command you use to decide whether a run is affordable, so its answer
 * has to be the same design that `run` would execute and that `verify` checks against
 * the lock. It was not: --suite was accepted and silently dropped, so canon.v0 sized at
 * 36 instances against a lock of 144 - a 4x under-report of every run's cost, with no
 * error anywhere.
 *
 * The shape is the project's characteristic failure: a plausible number, produced by
 * reading the wrong grid. So the assertions are agreement between the surfaces rather
 * than literal counts - a hardcoded 144 would go stale the moment the suite grew, and
 * would not catch the grid being wrong in a way that happened to preserve the total.
 */
// vitest runs from the workspace root, the same assumption the analysis tests make.
const ROOT = process.cwd();
const SUITE = join(ROOT, "content", "suites", "canon-v0.yaml");
const LOCK = join(ROOT, "content", "suites", "canon-v0.lock.json");

/** Run cmdExpand with real argv and capture what a user would see. */
async function expand(argv: readonly string[]): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...parts: unknown[]) => void lines.push(parts.map(String).join(" "));
  try {
    expect(await cmdExpand(parseArgs(argv))).toBe(0);
  } finally {
    console.log = original;
  }
  return lines;
}

function reported(lines: readonly string[], label: "full design" | "after filters"): number {
  const line = lines.find((l) => l.startsWith(`${label}:`));
  if (line === undefined) throw new Error(`no '${label}' line in:\n${lines.join("\n")}`);
  const count = Number.parseInt(line.slice(label.length + 1).trim(), 10);
  if (!Number.isFinite(count)) throw new Error(`unparseable '${label}' line: ${line}`);
  return count;
}

/** The indented `  <template id>   <count>` breakdown, as a map. */
function perTemplate(lines: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    if (!line.startsWith("  ")) continue;
    const [id, count] = line.trim().split(/\s+/);
    if (id === undefined || count === undefined) continue;
    const parsed = Number.parseInt(count, 10);
    if (Number.isFinite(parsed)) out.set(id, parsed);
  }
  return out;
}

describe("trolley expand --suite", () => {
  it("sizes the suite's own grid, not the CLI's default one", async () => {
    const lock = JSON.parse(await readFile(LOCK, "utf8")) as { instance_hashes: string[] };

    const lines = await expand(["expand", "--suite", SUITE]);

    expect(reported(lines, "after filters")).toBe(lock.instance_hashes.length);
  });

  it("agrees instance-for-instance with expandSuite, the shared expansion path", async () => {
    const packs = await loadPackDir(join(ROOT, "content", "packs"));
    const suite = await loadSuiteFile(SUITE);
    const instances = expandSuite(packs, suite);

    const lines = await expand(["expand", "--suite", SUITE]);

    // Per-template counts, not just the total: a wrong grid that happened to sum
    // correctly would still be a different experiment.
    const expected = new Map<string, number>();
    for (const i of instances) expected.set(i.template_id, (expected.get(i.template_id) ?? 0) + 1);

    expect(perTemplate(lines)).toEqual(expected);
    expect(reported(lines, "after filters")).toBe(instances.length);
  });

  it("is actually load-bearing: --suite changes the answer", async () => {
    // The bug was indistinguishable from the flag working, because dropping --suite
    // produced exactly the ad-hoc default. If these ever coincide again, the guarantee
    // above is being met by accident.
    const withSuite = await expand(["expand", "--suite", SUITE]);
    const adHoc = await expand(["expand"]);

    expect(reported(withSuite, "after filters")).not.toBe(reported(adHoc, "after filters"));
  });

  it("leaves the ad-hoc path on CLI flags", async () => {
    // --suite wins over design flags (matching `run`), but with no suite the flags must
    // still drive the grid, or this fix would have broken the other half of the command.
    const oneFramework = await expand(["expand", "--frameworks", "none"]);
    const four = await expand([
      "expand",
      "--frameworks",
      "none,act_utilitarian,kantian_deontological,contractualist",
    ]);

    expect(reported(four, "full design")).toBe(reported(oneFramework, "full design") * 4);
  });
});

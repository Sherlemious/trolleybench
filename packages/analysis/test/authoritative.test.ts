import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { expandInstances, loadPackDir } from "@trolleybench/scenarios";
import { readResults } from "@trolleybench/runner";
import { RunManifest, type ResultRow } from "@trolleybench/spec";
import { authoritativeRows, duplicateReport } from "../src/authoritative.js";

const ROOT = process.cwd();

function row(overrides: Partial<ResultRow>): ResultRow {
  return {
    run_id: "r",
    instance_hash: "sha256:aaa",
    subject_id: "s1",
    repetition: 0,
    elicitation_mode: "prompt",
    transport: "in_process",
    outcome: "act",
    raw_request: null,
    raw_response: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("authoritative rows", () => {
  it("keeps the newest attempt at a cell", () => {
    const rows = [
      row({ outcome: "error", timestamp: "2026-01-01T00:00:00.000Z" }),
      row({ outcome: "act", timestamp: "2026-01-01T00:05:00.000Z" }),
    ];
    const out = authoritativeRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.outcome).toBe("act");
  });

  it("does not merge different cells", () => {
    const rows = [
      row({ instance_hash: "sha256:a" }),
      row({ instance_hash: "sha256:b" }),
      row({ subject_id: "s2" }),
      row({ repetition: 1 }),
      row({ run_id: "other" }),
    ];
    expect(authoritativeRows(rows)).toHaveLength(5);
  });

  it("breaks timestamp ties on write order, so the later row wins", () => {
    const rows = [
      row({ outcome: "error", timestamp: "2026-01-01T00:00:00.000Z" }),
      row({ outcome: "omit", timestamp: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(authoritativeRows(rows)[0]!.outcome).toBe("omit");
  });

  it("counts an appended re-run as superseded rather than as new data", () => {
    const first = [row({ instance_hash: "sha256:a" }), row({ instance_hash: "sha256:b" })];
    const second = first.map((r) => ({ ...r, timestamp: "2026-02-01T00:00:00.000Z" }));
    const report = duplicateReport([...first, ...second]);
    expect(report).toEqual({ total: 4, authoritative: 2, superseded: 2 });
  });
});

/**
 * Regression guard for a bug that survived being "fixed" once.
 *
 * A suite run used to record the CLI's DEFAULT variation grid in its manifest rather
 * than the suite's own, so the committed sample said `moral_framework: ["none"]` beside
 * `instance_count: 144`. Re-expanding from that manifest recovered 36 instances and
 * silently dropped 108 rows as unjoinable — from `db import`, and from every estimate.
 * The earlier fix only held in a test that bypassed the manifest entirely.
 *
 * This asserts the property that was actually broken: the manifest alone is enough to
 * reconstruct the exact instance set the run covered.
 */
describe("the committed sample's manifest describes its own run", () => {
  it("re-expands to exactly the instances its results reference", async () => {
    const jsonl = join(ROOT, "content", "samples", "echo-demo.jsonl");
    const manifestPath = join(ROOT, "content", "samples", "echo-demo.manifest.json");

    const manifest = RunManifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    const packs = await loadPackDir(join(ROOT, "content", "packs"));

    const instances = expandInstances(packs, manifest.spec.variations, {
      packs: manifest.spec.selection?.packs,
      templates: manifest.spec.selection?.templates,
      tags: manifest.spec.selection?.tags,
      max_instances: manifest.spec.selection?.max_instances,
      seed: manifest.spec.seed,
    });
    expect(instances.length).toBe(manifest.instance_count);

    const index = new Set(instances.map((i) => i.hash));
    const loaded = await readResults(jsonl);
    const orphans = loaded.rows.filter((r) => !index.has(r.instance_hash));
    expect(orphans.length, `${orphans.length} result rows cannot be joined`).toBe(0);
  });

  it("names the suite it was run from", async () => {
    const manifest = RunManifest.parse(
      JSON.parse(await readFile(join(ROOT, "content", "samples", "echo-demo.manifest.json"), "utf8")),
    );
    expect(manifest.spec.suite).toBe("canon.v0@0.1.0");
  });

  it("holds one row per cell, not an appended re-run", async () => {
    const loaded = await readResults(join(ROOT, "content", "samples", "echo-demo.jsonl"));
    expect(duplicateReport(loaded.rows).superseded).toBe(0);
  });
});

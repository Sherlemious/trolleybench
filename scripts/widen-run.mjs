#!/usr/bin/env node
// Widen a `trolley agent` run's design along one variation axis, keeping its run id and
// every answer already recorded. The new cells are simply unanswered, so `agent next`
// serves only them.
//
// Usage: node scripts/widen-run.mjs <runs/run.manifest.json> <axis> <level,level...>
//   e.g. node scripts/widen-run.mjs runs/x.manifest.json option_order as_authored,reversed

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RunManifest, VariationGrid } from "@trolleybench/spec";
import { contentHash } from "@trolleybench/engine";
import { expandInstances, loadPackDir } from "@trolleybench/scenarios";

const [path, axis, levels] = process.argv.slice(2);
if (!path || !axis || !levels) throw new Error("usage: widen-run.mjs <manifest> <axis> <levels>");

const manifest = RunManifest.parse(JSON.parse(await readFile(path, "utf8")));
const before = manifest.spec.variations[axis];
if (!Array.isArray(before)) throw new Error(`'${axis}' is not a variation axis`);
const after = levels.split(",");
// Widening only: a narrower grid would orphan answers already on disk.
for (const level of before) {
  if (!after.includes(level)) throw new Error(`'${level}' is already in the run; it cannot be dropped`);
}

const variations = VariationGrid.parse({ ...manifest.spec.variations, [axis]: after });
const spec = { ...manifest.spec, variations };
const sel = spec.selection;
const instances = expandInstances(await loadPackDir(resolve("content/packs")), variations, {
  packs: sel?.packs,
  templates: sel?.templates,
  tags: sel?.tags,
  max_instances: sel?.max_instances,
  seed: spec.seed,
});

const out = { ...manifest, spec, spec_hash: contentHash(spec), instance_count: instances.length, finished_at: undefined };
await writeFile(path, `${JSON.stringify(RunManifest.parse(out), null, 2)}\n`, "utf8");
console.log(`${manifest.run_id}: ${axis} ${JSON.stringify(before)} -> ${JSON.stringify(after)}, ${manifest.instance_count} -> ${instances.length} instances`);

#!/usr/bin/env node
// Audit every run in the database: completeness, duplicates, orphans, and outcomes.
// Read-only. Usage: node scripts/audit-db.mjs   (reads DATABASE_URL from .env.local)

import { readDotEnv } from "@trolleybench/adapters";
import { connect, listStoredRuns, loadStoredRun } from "@trolleybench/store";

const env = { ...(await readDotEnv(process.cwd())), ...process.env };
const url = env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { db, close } = connect({ url });

try {
  for (const run of await listStoredRuns(db)) {
    const stored = await loadStoredRun(db, run.runId);
    const rows = stored?.rows ?? [];
    const hashes = new Set((stored?.instances ?? []).map((i) => i.hash));
    const keys = rows.map((r) => `${r.instance_hash}|${r.subject_id}|${r.repetition}`);
    const dupes = keys.length - new Set(keys).size;
    const orphans = rows.filter((r) => !hashes.has(r.instance_hash)).length;
    const outcomes = {};
    for (const r of rows) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    const modes = [...new Set(rows.map((r) => r.elicitation_mode))];
    const flags = [
      run.rows < run.planned ? `INCOMPLETE ${run.rows}/${run.planned}` : "",
      dupes ? `DUPES ${dupes}` : "",
      orphans ? `ORPHANS ${orphans}` : "",
      modes.length > 1 ? `MIXED MODES ${modes.join("+")}` : "",
      modes[0] && modes[0] !== run.mode ? `MODE MISMATCH run=${run.mode} rows=${modes[0]}` : "",
    ].filter(Boolean);
    console.log(
      `${run.runId.padEnd(62)} ${run.mode.padEnd(9)} ${String(run.rows).padStart(4)} ${run.review.padEnd(10)} ` +
        `${JSON.stringify(outcomes)} ${run.subjects[0]?.model ?? "?"} ${flags.join(" ")}`,
    );
  }
} finally {
  await close();
}

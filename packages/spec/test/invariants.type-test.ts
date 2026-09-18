import type { ModeScopedRows } from "../src/mode-scoped.js";
import { partitionByMode, scopeToMode } from "../src/mode-scoped.js";
import type { ResultRow } from "../src/result.js";

declare const rows: ResultRow[];

// Stand-in for an aggregator in @trolley/analysis.
function utilitarianRate(_scoped: ModeScopedRows): number { return 0; }

// 1. A bare ResultRow[] must NOT satisfy the aggregator's parameter.
// @ts-expect-error - invariant 1: cannot aggregate without partitioning first
utilitarianRate(rows);

// 2. A hand-built array must NOT satisfy it either.
// @ts-expect-error - invariant 1: runtime-assembled arrays are not mode-scoped
utilitarianRate(rows.filter((r) => r.elicitation_mode === "prompt"));

// 3. Concatenating two scoped buckets must NOT survive as scoped.
declare const a: ModeScopedRows;
declare const b: ModeScopedRows;
// @ts-expect-error - invariant 1: concat drops the brand, so pooling cannot typecheck
utilitarianRate(a.concat(b));

// 4. The sanctioned paths DO work.
const parts = partitionByMode(rows);
const prompt = parts.get("prompt");
if (prompt) utilitarianRate(prompt);
const scoped = scopeToMode(rows, "mcp_tool");
if (scoped) utilitarianRate(scoped);

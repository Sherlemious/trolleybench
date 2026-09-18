import { sql, type SQL } from "drizzle-orm";
import type { ElicitationMode, Outcome } from "@trolleybench/spec";
import { VALID_OUTCOMES } from "@trolleybench/spec";
import type { Db } from "./client.js";
import { results } from "./schema.js";

/**
 * INVARIANT 1 AT THE SQL BOUNDARY.
 *
 * A TypeScript brand cannot survive a round trip through the database, so the brand
 * that protects `@trolleybench/analysis` is useless here. The enforcement is moved into
 * the shape of the API instead: `mode` is a REQUIRED field on every aggregate's filter,
 * and no aggregate in this module accepts "all modes". Pooling a prompt-mode rate with
 * an mcp_tool-mode rate has to be written out deliberately, as two calls the caller then
 * combines; it can never happen by forgetting an argument.
 */
export interface ScopedFilter {
  /** Required. There is deliberately no "all modes" option. */
  mode: ElicitationMode;
  runId?: string;
  subjectId?: string;
  instanceHashes?: readonly string[];
}

function whereFor(filter: ScopedFilter): SQL {
  const clauses: SQL[] = [sql`${results.elicitationMode} = ${filter.mode}`];
  if (filter.runId) clauses.push(sql`${results.runId} = ${filter.runId}`);
  if (filter.subjectId) clauses.push(sql`${results.subjectId} = ${filter.subjectId}`);
  if (filter.instanceHashes?.length) {
    clauses.push(sql`${results.instanceHash} = ANY(${sql.param(filter.instanceHashes)})`);
  }
  return sql.join(clauses, sql` and `);
}

/**
 * The authoritative observation per cell.
 *
 * Every attempt is stored, including ones that errored and were later retried by
 * `--resume`. For analysis we want exactly one row per
 * (run, instance, subject, repetition) — the most recent attempt. Postgres DISTINCT ON
 * does this in one pass without a window function or a self join.
 */
export function authoritativeCte(filter: ScopedFilter): SQL {
  // No table alias here: Drizzle renders column references as "results"."col", so an
  // alias would hide the table from its own WHERE clause and Postgres rejects the query.
  return sql`
    select distinct on (${results.runId}, ${results.instanceHash}, ${results.subjectId}, ${results.repetition})
           ${results}.*
    from ${results}
    where ${whereFor(filter)}
    order by ${results.runId}, ${results.instanceHash}, ${results.subjectId}, ${results.repetition},
             ${results.timestamp} desc
  `;
}

/**
 * Normalize a raw result across drivers.
 *
 * postgres.js resolves `execute` to the row array directly; PGlite resolves it to
 * `{ rows: [...] }`. Typing against the driver-agnostic base erases both shapes to
 * `unknown`, so this is the one place that reconciles them - rather than every query
 * carrying a cast that silently returns [] on the other driver.
 */
async function rawRows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown;
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

export interface OutcomeBreakdown {
  mode: ElicitationMode;
  counts: Record<Outcome, number>;
  total: number;
  /** Denominator for a choice rate: act + omit only. */
  nValid: number;
  actRate: number | null;
  refusalRate: number;
  unparseableRate: number;
  errorRate: number;
}

const ALL_OUTCOMES: Outcome[] = ["act", "omit", "refusal", "unparseable", "rating", "error"];

/**
 * INVARIANT 2 in practice. `actRate` is over act+omit only, and the refusal and
 * unparseable rates are returned beside it rather than left for the caller to remember
 * — they swing the headline number, and a rate published without them is misleading.
 * `actRate` is null when nothing valid was observed, never a silent 0.
 */
export async function outcomeBreakdown(db: Db, filter: ScopedFilter): Promise<OutcomeBreakdown> {
  const rows = await rawRows<{ outcome: string; n: number }>(db, sql`
    with authoritative as (${authoritativeCte(filter)})
    select outcome, count(*)::int as n from authoritative group by outcome
  `);

  const counts = Object.fromEntries(ALL_OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  for (const row of rows) {
    if ((ALL_OUTCOMES as string[]).includes(row.outcome)) counts[row.outcome as Outcome] = Number(row.n);
  }

  const total = ALL_OUTCOMES.reduce((sum, o) => sum + counts[o], 0);
  const nValid = VALID_OUTCOMES.reduce((sum, o) => sum + counts[o], 0);

  return {
    mode: filter.mode,
    counts,
    total,
    nValid,
    actRate: nValid > 0 ? counts.act / nValid : null,
    refusalRate: total > 0 ? counts.refusal / total : 0,
    unparseableRate: total > 0 ? counts.unparseable / total : 0,
    errorRate: total > 0 ? counts.error / total : 0,
  };
}

export type GroupableField =
  | "moral_framework"
  | "option_order"
  | "language"
  | "framing"
  | "template_id"
  | "pack_id";

const GROUPABLE: Record<GroupableField, string> = {
  moral_framework: "i.moral_framework",
  option_order: "i.option_order",
  language: "i.language",
  framing: "i.framing",
  template_id: "i.template_id",
  pack_id: "i.pack_id",
};

export interface GroupedRate {
  group: string;
  nValid: number;
  total: number;
  act: number;
  omit: number;
  refusal: number;
  unparseable: number;
  actRate: number | null;
  refusalRate: number;
}

/**
 * Choice rate grouped by one design axis, joined to the instance so the grouping is on
 * the experiment's own factors rather than on anything the model returned.
 */
export async function ratesBy(
  db: Db,
  field: GroupableField,
  filter: ScopedFilter,
): Promise<GroupedRate[]> {
  const column = GROUPABLE[field];
  if (!column) throw new Error(`not a groupable design field: ${field}`);

  const rows = await rawRows<{
    group: string;
    act: number;
    omit: number;
    refusal: number;
    unparseable: number;
    total: number;
  }>(db, sql`
    with authoritative as (${authoritativeCte(filter)})
    select
      ${sql.raw(column)} as group,
      count(*) filter (where a.outcome = 'act')::int as act,
      count(*) filter (where a.outcome = 'omit')::int as omit,
      count(*) filter (where a.outcome = 'refusal')::int as refusal,
      count(*) filter (where a.outcome = 'unparseable')::int as unparseable,
      count(*)::int as total
    from authoritative a
    join instances i on i.hash = a.instance_hash
    group by ${sql.raw(column)}
    order by ${sql.raw(column)}
  `);

  return rows.map((r) => {
    const act = Number(r.act);
    const omit = Number(r.omit);
    const nValid = act + omit;
    const total = Number(r.total);
    return {
      group: r.group,
      act,
      omit,
      refusal: Number(r.refusal),
      unparseable: Number(r.unparseable),
      nValid,
      total,
      actRate: nValid > 0 ? act / nValid : null,
      refusalRate: total > 0 ? Number(r.refusal) / total : 0,
    };
  });
}

/**
 * Which modes a run actually contains.
 *
 * Safe to call without a mode because it AGGREGATES NOTHING — it exists precisely so a
 * caller can discover the modes present and then query each one separately, which is
 * the only correct way to report a run that mixed them.
 */
export async function modesPresent(
  db: Db,
  runId?: string,
): Promise<Array<{ mode: ElicitationMode; n: number }>> {
  const rows = await rawRows<{ elicitation_mode: string; n: number }>(db, sql`
    select elicitation_mode, count(*)::int as n
    from ${results}
    ${runId ? sql`where run_id = ${runId}` : sql``}
    group by elicitation_mode
    order by elicitation_mode
  `);
  return rows.map((r) => ({ mode: r.elicitation_mode as ElicitationMode, n: Number(r.n) }));
}

export interface RunSummary {
  runId: string;
  startedAt: Date;
  toolVersion: string;
  instanceCount: number;
  elicitationMode: string;
  rows: number;
}

export async function listRuns(db: Db, limit = 50): Promise<RunSummary[]> {
  const rows = await rawRows<{
    run_id: string;
    started_at: string;
    tool_version: string;
    instance_count: number;
    elicitation_mode: string;
    rows: number;
  }>(db, sql`
    select r.run_id, r.started_at, r.tool_version, r.instance_count, r.elicitation_mode,
           count(res.id)::int as rows
    from runs r
    left join ${results} res on res.run_id = r.run_id
    group by r.run_id, r.started_at, r.tool_version, r.instance_count, r.elicitation_mode
    order by r.started_at desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    runId: r.run_id,
    startedAt: new Date(r.started_at),
    toolVersion: r.tool_version,
    instanceCount: Number(r.instance_count),
    elicitationMode: r.elicitation_mode,
    rows: Number(r.rows),
  }));
}

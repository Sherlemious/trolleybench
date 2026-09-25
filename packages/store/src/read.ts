import { asc, eq, inArray, sql } from "drizzle-orm";
import {
  ResultRow,
  RunSpec,
  ScenarioInstance,
  type ElicitationMode,
} from "@trolleybench/spec";
import type { Db } from "./client.js";
import { instances, results, runSubjects, runs } from "./schema.js";

/**
 * Reading a run BACK OUT, in the exact shapes the analysis package consumes.
 *
 * The web app computes every figure through `@trolleybench/analysis`, the same code
 * `trolley analyze` runs over a JSONL file. For the database to be a drop-in source for
 * those figures it has to return `ResultRow` and `ScenarioInstance`, parsed through
 * their schemas - not a lookalike the analysis would accept and then misread. Every row
 * attempt comes back, not only the newest: newest-wins is the analysis layer's rule
 * (`authoritativeRows`), and applying it here as well would give two places to get it
 * wrong.
 */

export interface StoredSubject {
  subjectId: string;
  provider: string;
  model: string;
  providerModelString: string | null;
}

export interface StoredRun {
  runId: string;
  mode: ElicitationMode;
  startedAt: string;
  finishedAt: string | null;
  toolVersion: string;
  instanceCount: number;
  suite: string | null;
  subjects: StoredSubject[];
  rows: number;
  /** `cli` for an imported JSONL; `api`, `mcp` or `browser` for a hosted run. */
  origin: string;
  /** The model's identity is the caller's say-so. True for every hosted run. */
  selfReported: boolean;
  /** Items the run set out to answer; `rows` below this means it is still in progress. */
  planned: number;
  /** `unreviewed` | `approved` | `rejected`. */
  review: string;
  /**
   * Salted hash of the submitter's address, for grouping one submitter's runs. Never
   * send it to a browser: an unsalted address hash is cheap to reverse.
   */
  clientHash: string | null;
}

export async function listStoredRuns(db: Db): Promise<StoredRun[]> {
  const runRows = await db
    .select({
      runId: runs.runId,
      mode: runs.elicitationMode,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      toolVersion: runs.toolVersion,
      instanceCount: runs.instanceCount,
      spec: runs.spec,
      origin: runs.origin,
      selfReported: runs.selfReported,
      itemOrder: runs.itemOrder,
      review: runs.review,
      clientHash: runs.clientHash,
      // Qualified by hand: inside a correlated subquery, Drizzle renders an outer column
      // unqualified, and an unqualified "run_id" binds to the INNER table - which made
      // this count every row in the database for every run.
      rows: sql<number>`(select count(*)::int from "results" as r where r.run_id = "runs"."run_id")`,
    })
    .from(runs)
    .orderBy(asc(runs.startedAt));

  const subjects = await db.select().from(runSubjects);
  const byRun = new Map<string, StoredSubject[]>();
  for (const s of subjects) {
    const list = byRun.get(s.runId) ?? [];
    list.push({
      subjectId: s.subjectId,
      provider: s.provider,
      model: s.model,
      providerModelString: s.providerModelString,
    });
    byRun.set(s.runId, list);
  }

  return runRows.map((r) => ({
    runId: r.runId,
    mode: r.mode as ElicitationMode,
    startedAt: toIso(r.startedAt),
    finishedAt: r.finishedAt ? toIso(r.finishedAt) : null,
    toolVersion: r.toolVersion,
    instanceCount: r.instanceCount,
    suite: (r.spec as { suite?: string } | null)?.suite ?? null,
    subjects: byRun.get(r.runId) ?? [],
    rows: Number(r.rows),
    origin: r.origin,
    selfReported: r.selfReported,
    planned: Array.isArray(r.itemOrder) ? r.itemOrder.length : r.instanceCount,
    review: r.review,
    clientHash: r.clientHash,
  }));
}

export type ReviewDecision = "approved" | "rejected" | "unreviewed";

/** Record a maintainer's decision on a run. Returns false if there is no such run. */
export async function reviewRun(db: Db, runId: string, decision: ReviewDecision, note?: string): Promise<boolean> {
  const updated = await db
    .update(runs)
    .set({ review: decision, reviewedAt: decision === "unreviewed" ? null : new Date(), reviewNote: note ?? null })
    .where(eq(runs.runId, runId))
    .returning({ runId: runs.runId });
  return updated.length > 0;
}

export interface LoadedStoredRun {
  spec: RunSpec;
  rows: ResultRow[];
  instances: ScenarioInstance[];
}

/**
 * One run's rows and the instances they reference. Raw provider payloads are left
 * behind: they are the bulk of the table, and nothing that computes a rate reads them.
 */
export async function loadStoredRun(db: Db, runId: string): Promise<LoadedStoredRun | null> {
  const [run] = await db.select({ spec: runs.spec }).from(runs).where(eq(runs.runId, runId));
  if (!run) return null;

  const resultRows = await db
    .select({
      runId: results.runId,
      instanceHash: results.instanceHash,
      subjectId: results.subjectId,
      repetition: results.repetition,
      elicitationMode: results.elicitationMode,
      transport: results.transport,
      outcome: results.outcome,
      chosenOptionId: results.chosenOptionId,
      rating: results.rating,
      confidence: results.confidence,
      providerModelString: results.providerModelString,
      latencyMs: results.latencyMs,
      timestamp: results.timestamp,
    })
    .from(results)
    .where(eq(results.runId, runId));

  const rows = resultRows.map((r) =>
    ResultRow.parse({
      run_id: r.runId,
      instance_hash: r.instanceHash,
      subject_id: r.subjectId,
      repetition: r.repetition,
      elicitation_mode: r.elicitationMode,
      transport: r.transport,
      outcome: r.outcome,
      chosen_option_id: r.chosenOptionId ?? undefined,
      rating: r.rating ?? undefined,
      confidence: r.confidence ?? undefined,
      provider_model_string: r.providerModelString ?? undefined,
      latency_ms: r.latencyMs ?? undefined,
      raw_request: null,
      raw_response: null,
      timestamp: toIso(r.timestamp),
    }),
  );

  const hashes = [...new Set(rows.map((r) => r.instance_hash))];
  const instanceRows = hashes.length
    ? await db.select().from(instances).where(inArray(instances.hash, hashes))
    : [];

  return {
    spec: RunSpec.parse(run.spec),
    rows,
    instances: instanceRows.map((i) =>
      ScenarioInstance.parse({
        hash: i.hash,
        template_id: i.templateId,
        template_version: i.templateVersion,
        pack_id: i.packId,
        factors: i.factors,
        variation: i.variation,
        narrative: i.narrative,
        question: i.question,
        options: i.options,
        system_prompt: i.systemPrompt ?? undefined,
      }),
    ),
  };
}

/** postgres.js returns Date; PGlite may return a string. Normalise to ISO-8601. */
function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

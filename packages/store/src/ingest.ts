import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { RunManifest, type ResultRow, type ScenarioInstance } from "@trolleybench/spec";
import { contentHash } from "@trolleybench/engine";
import { readResults } from "@trolleybench/runner";
import type { Db } from "./client.js";
import { instances, results, runSubjects, runs } from "./schema.js";

export interface IngestReport {
  runId: string;
  resultsSeen: number;
  resultsInserted: number;
  resultsAlreadyPresent: number;
  instancesUpserted: number;
  malformedLines: number;
  /**
   * Results whose instance_hash has no row in `instances`. Non-zero means the grid
   * used to expand instances did not cover the run - every grouped query would then
   * silently drop those rows rather than fail, so it is reported loudly.
   */
  resultsWithoutInstance: number;
}

export interface IngestOptions {
  /** Path to the run's .jsonl. The manifest is found beside it. */
  jsonlPath: string;
  manifestPath?: string;
  /** Instances to record. Without them, results still import but carry no stimulus. */
  instances?: readonly ScenarioInstance[];
  batchSize?: number;
}

/**
 * The identity of one elicitation attempt: a hash of the row's meaningful content.
 *
 * Re-importing the same file must be a no-op, and `--resume` legitimately produces a
 * second row for a cell whose first attempt errored — so neither the cell key nor file
 * position can serve as the identity. The timestamp distinguishes attempts; everything
 * else distinguishes observations.
 */
export function resultId(row: ResultRow): string {
  return contentHash({
    run_id: row.run_id,
    instance_hash: row.instance_hash,
    subject_id: row.subject_id,
    repetition: row.repetition,
    elicitation_mode: row.elicitation_mode,
    outcome: row.outcome,
    chosen_option_id: row.chosen_option_id,
    rating: row.rating,
    justification_text: row.justification_text,
    error_message: row.error_message,
    timestamp: row.timestamp,
  });
}

export async function ingestRun(db: Db, options: IngestOptions): Promise<IngestReport> {
  const manifestPath = options.manifestPath ?? options.jsonlPath.replace(/\.jsonl$/, "") + ".manifest.json";
  const manifest = RunManifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const loaded = await readResults(options.jsonlPath);
  const batchSize = options.batchSize ?? 500;

  const before = await countForRun(db, manifest.run_id);

  await db.transaction(async (tx) => {
    await tx
      .insert(runs)
      .values({
        runId: manifest.run_id,
        specHash: manifest.spec_hash,
        toolVersion: manifest.tool_version,
        startedAt: new Date(manifest.started_at),
        finishedAt: manifest.finished_at ? new Date(manifest.finished_at) : null,
        instanceCount: manifest.instance_count,
        elicitationMode: manifest.spec.elicitation_mode,
        repetitions: manifest.spec.repetitions,
        seed: manifest.spec.seed,
        biasAuditPurpose: manifest.spec.bias_audit?.purpose ?? null,
        spec: manifest.spec,
        sourceFile: options.jsonlPath,
      })
      .onConflictDoUpdate({
        target: runs.runId,
        set: {
          finishedAt: manifest.finished_at ? new Date(manifest.finished_at) : null,
          instanceCount: manifest.instance_count,
          sourceFile: options.jsonlPath,
        },
      });

    for (const resolved of manifest.subjects_resolved) {
      const spec = manifest.spec.subjects.find((s) => s.id === resolved.subject_id);
      await tx
        .insert(runSubjects)
        .values({
          runId: manifest.run_id,
          subjectId: resolved.subject_id,
          provider: spec?.provider ?? "unknown",
          model: spec?.model ?? "unknown",
          providerModelString: resolved.provider_model_string ?? null,
          transport: resolved.transport,
        })
        .onConflictDoNothing();
    }

    if (options.instances?.length) {
      for (const chunk of batches(options.instances, batchSize)) {
        await tx
          .insert(instances)
          .values(
            chunk.map((i) => ({
              hash: i.hash,
              templateId: i.template_id,
              templateVersion: i.template_version,
              packId: i.pack_id,
              factors: i.factors,
              variation: i.variation,
              language: i.variation.language,
              framing: i.variation.framing,
              optionOrder: i.variation.option_order,
              moralFramework: i.variation.moral_framework,
              responseFormat: i.variation.response_format,
              narrative: i.narrative,
              question: i.question,
              options: i.options,
              systemPrompt: i.system_prompt ?? null,
            })),
          )
          // Content-addressed: the same hash is the same stimulus, so a conflict means
          // we already have it and there is nothing to change.
          .onConflictDoNothing({ target: instances.hash });
      }
    }

    for (const chunk of batches(loaded.rows, batchSize)) {
      await tx
        .insert(results)
        .values(
          chunk.map((r) => ({
            id: resultId(r),
            runId: r.run_id,
            instanceHash: r.instance_hash,
            subjectId: r.subject_id,
            repetition: r.repetition,
            elicitationMode: r.elicitation_mode,
            transport: r.transport,
            outcome: r.outcome,
            chosenOptionId: r.chosen_option_id ?? null,
            rating: r.rating ?? null,
            confidence: r.confidence ?? null,
            justificationText: r.justification_text ?? null,
            detectedFramework: r.detected_framework ?? null,
            providerModelString: r.provider_model_string ?? null,
            latencyMs: r.latency_ms ?? null,
            usage: r.usage ?? null,
            errorMessage: r.error_message ?? null,
            rawRequest: r.raw_request ?? null,
            rawResponse: r.raw_response ?? null,
            timestamp: new Date(r.timestamp),
          })),
        )
        .onConflictDoNothing({ target: results.id });
    }
  });

  const after = await countForRun(db, manifest.run_id);
  const inserted = after - before;
  const orphans = await countOrphans(db, manifest.run_id);

  return {
    runId: manifest.run_id,
    resultsSeen: loaded.rows.length,
    resultsInserted: inserted,
    resultsAlreadyPresent: loaded.rows.length - inserted,
    instancesUpserted: options.instances?.length ?? 0,
    malformedLines: loaded.malformed,
    resultsWithoutInstance: orphans,
  };
}

async function countForRun(db: Db, runId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(results)
    .where(sql`${results.runId} = ${runId}`);
  return rows[0]?.n ?? 0;
}

async function countOrphans(db: Db, runId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(results)
    .where(
      sql`${results.runId} = ${runId} and not exists (
        select 1 from ${instances} where ${instances.hash} = ${results.instanceHash}
      )`,
    );
  return rows[0]?.n ?? 0;
}

function* batches<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

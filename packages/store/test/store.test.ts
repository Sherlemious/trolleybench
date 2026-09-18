import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { ResultRow, ScenarioInstance } from "@trolleybench/spec";
import type { Db } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { ingestRun, resultId } from "../src/ingest.js";
import { listRuns, modesPresent, outcomeBreakdown, ratesBy } from "../src/query.js";
import * as schema from "../src/schema.js";

/**
 * PGlite is real Postgres compiled to WASM, running in-process. Tests therefore
 * exercise the actual SQL - DISTINCT ON, FILTER clauses, jsonb - rather than a mock
 * that would happily agree with a broken query. No server, no credentials, no Docker.
 */
let client: PGlite;
let db: Db;
let dir: string;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db);
  dir = await mkdtemp(join(tmpdir(), "tb-store-"));
});

afterEach(async () => {
  await client.close();
});

function instance(n: number, over: Partial<ScenarioInstance> = {}): ScenarioInstance {
  return {
    hash: `sha256:${String(n).padStart(64, "0")}`,
    template_id: "foot.bystander_switch",
    template_version: "0.1.0",
    pack_id: "classic",
    factors: { ratio: "r1v5" },
    variation: {
      language: "en",
      framing: "neutral",
      perspective: "second_person",
      option_order: "as_authored",
      moral_framework: "none",
      response_format: "forced_choice",
      reasoning_mode: "direct",
    },
    narrative: `Scenario ${n}.`,
    question: "Do you pull the lever?",
    options: [
      { id: "pull", polarity: "act", label: "Pull.", position: 0 },
      { id: "not_pull", polarity: "omit", label: "Do not pull.", position: 1 },
    ],
    ...over,
  } as ScenarioInstance;
}

function row(over: Partial<ResultRow> = {}): ResultRow {
  return {
    run_id: "r1",
    instance_hash: instance(1).hash,
    subject_id: "sub",
    repetition: 0,
    elicitation_mode: "prompt",
    transport: "https",
    outcome: "act",
    chosen_option_id: "pull",
    raw_request: { user: "..." },
    raw_response: { text: "A" },
    timestamp: "2026-01-01T00:00:00.000Z",
    ...over,
  } as ResultRow;
}

async function writeRun(
  rows: ResultRow[],
  opts: { runId?: string; mode?: string } = {},
): Promise<string> {
  const runId = opts.runId ?? "r1";
  const jsonl = join(dir, `${runId}.jsonl`);
  await writeFile(jsonl, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  await writeFile(
    join(dir, `${runId}.manifest.json`),
    JSON.stringify({
      run_id: runId,
      spec: {
        id: runId,
        created_at: "2026-01-01T00:00:00.000Z",
        subjects: [{ id: "sub", kind: "model", provider: "echo", model: "echo", params: {} }],
        variations: {
          language: ["en"],
          framing: ["neutral"],
          perspective: ["second_person"],
          option_order: ["as_authored"],
          moral_framework: ["none"],
          response_format: ["forced_choice"],
          reasoning_mode: ["direct"],
          persona: [],
          identity: [],
        },
        repetitions: 1,
        elicitation_mode: opts.mode ?? "prompt",
        seed: 0,
        concurrency: 4,
      },
      spec_hash: "sha256:" + "a".repeat(64),
      tool_version: "0.1.0",
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:01:00.000Z",
      instance_count: 1,
      subjects_resolved: [{ subject_id: "sub", provider_model_string: "echo/v1", transport: "in_process" }],
      counts: {},
    }),
    "utf8",
  );
  return jsonl;
}

describe("migrate", () => {
  it("creates every table and is safe to run twice", async () => {
    const first = await migrate(db);
    expect(first.tables).toEqual(["instances", "results", "run_subjects", "runs"]);
    const second = await migrate(db);
    expect(second.tables).toEqual(first.tables);
  });
});

describe("ingest", () => {
  it("imports results, instances and subjects", async () => {
    const path = await writeRun([row(), row({ repetition: 1, outcome: "omit", chosen_option_id: "not_pull" })]);
    const report = await ingestRun(db, { jsonlPath: path, instances: [instance(1)] });

    expect(report.resultsSeen).toBe(2);
    expect(report.resultsInserted).toBe(2);
    expect(report.malformedLines).toBe(0);

    const runs = await listRuns(db);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runId).toBe("r1");
    expect(runs[0]?.rows).toBe(2);
  });

  /** Re-importing the same file must add nothing - the ingest is derived, not a log. */
  it("is idempotent across repeated imports", async () => {
    const path = await writeRun([row(), row({ repetition: 1 })]);
    const first = await ingestRun(db, { jsonlPath: path, instances: [instance(1)] });
    const second = await ingestRun(db, { jsonlPath: path, instances: [instance(1)] });

    expect(first.resultsInserted).toBe(2);
    expect(second.resultsInserted).toBe(0);
    expect(second.resultsAlreadyPresent).toBe(2);
    expect((await listRuns(db))[0]?.rows).toBe(2);
  });

  /**
   * `--resume` appends a second row for a cell whose first attempt errored, so the
   * cell key is NOT unique in the source file. Both attempts must survive: the error
   * is evidence about reliability, not noise.
   */
  it("keeps every attempt for a retried cell", async () => {
    const path = await writeRun([
      row({ outcome: "error", chosen_option_id: undefined, error_message: "boom", timestamp: "2026-01-01T00:00:00.000Z" }),
      row({ outcome: "act", timestamp: "2026-01-01T00:05:00.000Z" }),
    ]);
    const report = await ingestRun(db, { jsonlPath: path, instances: [instance(1)] });
    expect(report.resultsInserted).toBe(2);
  });

  it("gives two attempts of the same cell different ids", () => {
    const a = resultId(row({ outcome: "error", timestamp: "2026-01-01T00:00:00.000Z" }));
    const b = resultId(row({ outcome: "act", timestamp: "2026-01-01T00:05:00.000Z" }));
    expect(a).not.toBe(b);
  });

  it("gives an identical row the same id", () => {
    expect(resultId(row())).toBe(resultId(row()));
  });
});

describe("authoritative observation", () => {
  it("takes the newest attempt per cell, so a retried error does not count", async () => {
    const path = await writeRun([
      row({ outcome: "error", chosen_option_id: undefined, error_message: "boom", timestamp: "2026-01-01T00:00:00.000Z" }),
      row({ outcome: "act", timestamp: "2026-01-01T00:05:00.000Z" }),
    ]);
    await ingestRun(db, { jsonlPath: path, instances: [instance(1)] });

    const breakdown = await outcomeBreakdown(db, { mode: "prompt" });
    // Both rows are stored, but only the later one is authoritative.
    expect(breakdown.total).toBe(1);
    expect(breakdown.counts.act).toBe(1);
    expect(breakdown.counts.error).toBe(0);
  });
});

describe("outcome breakdown", () => {
  it("reports refusal and unparseable rates beside the act rate", async () => {
    const path = await writeRun([
      row({ repetition: 0, outcome: "act" }),
      row({ repetition: 1, outcome: "omit", chosen_option_id: "not_pull" }),
      row({ repetition: 2, outcome: "omit", chosen_option_id: "not_pull" }),
      row({ repetition: 3, outcome: "refusal", chosen_option_id: undefined }),
      row({ repetition: 4, outcome: "unparseable", chosen_option_id: undefined }),
    ]);
    await ingestRun(db, { jsonlPath: path, instances: [instance(1)] });

    const b = await outcomeBreakdown(db, { mode: "prompt" });
    expect(b.total).toBe(5);
    // INVARIANT 2: the denominator is act+omit, not everything.
    expect(b.nValid).toBe(3);
    expect(b.actRate).toBeCloseTo(1 / 3);
    expect(b.refusalRate).toBeCloseTo(1 / 5);
    expect(b.unparseableRate).toBeCloseTo(1 / 5);
  });

  it("returns a null act rate rather than a misleading zero when nothing is valid", async () => {
    const path = await writeRun([row({ outcome: "refusal", chosen_option_id: undefined })]);
    await ingestRun(db, { jsonlPath: path, instances: [instance(1)] });

    const b = await outcomeBreakdown(db, { mode: "prompt" });
    expect(b.nValid).toBe(0);
    expect(b.actRate).toBeNull();
    expect(b.refusalRate).toBe(1);
  });

  it("excludes `rating` from the choice-rate denominator", async () => {
    const path = await writeRun([
      row({ repetition: 0, outcome: "act" }),
      row({ repetition: 1, outcome: "rating", chosen_option_id: undefined, rating: 5 }),
    ]);
    await ingestRun(db, { jsonlPath: path, instances: [instance(1)] });

    const b = await outcomeBreakdown(db, { mode: "prompt" });
    expect(b.counts.rating).toBe(1);
    expect(b.nValid).toBe(1);
    expect(b.actRate).toBe(1);
  });
});

/**
 * INVARIANT 1 at the SQL boundary. The TypeScript brand cannot cross a query, so the
 * protection is that `mode` is a required argument and no aggregate spans modes.
 */
describe("elicitation mode isolation", () => {
  beforeEach(async () => {
    const promptRun = await writeRun(
      [row({ outcome: "act" }), row({ repetition: 1, outcome: "act" })],
      { runId: "prompt-run", mode: "prompt" },
    );
    await ingestRun(db, { jsonlPath: promptRun, instances: [instance(1)] });

    const toolRun = await writeRun(
      [
        row({ run_id: "tool-run", elicitation_mode: "mcp_tool", transport: "mcp_stdio", outcome: "omit", chosen_option_id: "not_pull" }),
        row({ run_id: "tool-run", repetition: 1, elicitation_mode: "mcp_tool", transport: "mcp_stdio", outcome: "omit", chosen_option_id: "not_pull" }),
      ],
      { runId: "tool-run", mode: "mcp_tool" },
    );
    await ingestRun(db, { jsonlPath: toolRun, instances: [instance(1)] });
  });

  it("never mixes modes in an aggregate", async () => {
    const prompt = await outcomeBreakdown(db, { mode: "prompt" });
    const tool = await outcomeBreakdown(db, { mode: "mcp_tool" });

    expect(prompt.total).toBe(2);
    expect(prompt.actRate).toBe(1);
    expect(tool.total).toBe(2);
    expect(tool.actRate).toBe(0);

    // The pooled figure would be 0.5 and would mean nothing. It is only reachable by
    // deliberately combining two explicit calls, never by omitting an argument.
    expect(prompt.total + tool.total).toBe(4);
  });

  it("lists the modes present without aggregating across them", async () => {
    const modes = await modesPresent(db);
    expect(modes).toEqual([
      { mode: "mcp_tool", n: 2 },
      { mode: "prompt", n: 2 },
    ]);
  });

  it("keeps transport as provenance, distinct from mode", async () => {
    // Both rows of tool-run arrived over mcp_stdio; that must not change their mode.
    const tool = await outcomeBreakdown(db, { mode: "mcp_tool", runId: "tool-run" });
    expect(tool.total).toBe(2);
  });
});

describe("grouped rates", () => {
  it("groups by a design axis using the instance, not the response", async () => {
    const kantian = instance(2, {
      hash: `sha256:${String(2).padStart(64, "0")}`,
      variation: { ...instance(1).variation, moral_framework: "kantian_deontological" },
    } as Partial<ScenarioInstance>);

    const path = await writeRun([
      row({ repetition: 0, outcome: "act" }),
      row({ repetition: 1, outcome: "act" }),
      row({ instance_hash: kantian.hash, repetition: 0, outcome: "omit", chosen_option_id: "not_pull" }),
    ]);
    await ingestRun(db, { jsonlPath: path, instances: [instance(1), kantian] });

    const byFramework = await ratesBy(db, "moral_framework", { mode: "prompt" });
    const none = byFramework.find((g) => g.group === "none");
    const kant = byFramework.find((g) => g.group === "kantian_deontological");

    expect(none?.actRate).toBe(1);
    expect(none?.nValid).toBe(2);
    expect(kant?.actRate).toBe(0);
    expect(kant?.nValid).toBe(1);
  });

  it("rejects a grouping field that is not a design axis", async () => {
    await expect(
      ratesBy(db, "outcome" as never, { mode: "prompt" }),
    ).rejects.toThrow(/not a groupable design field/);
  });
});

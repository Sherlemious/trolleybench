import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { expandSuite, loadPackDir, loadSuiteFile } from "@trolleybench/scenarios";
import type { Db } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { ingestRun } from "../src/ingest.js";
import { modesPresent, outcomeBreakdown, ratesBy } from "../src/query.js";
import * as schema from "../src/schema.js";

/**
 * End-to-end against the committed sample run: real packs, real instance hashes, real
 * result rows produced by the CLI. Synthetic rows can agree with a broken join; these
 * cannot, because the join key is a content hash computed by the engine.
 */
const ROOT = process.cwd();
const SAMPLE = join(ROOT, "content", "samples", "echo-demo.jsonl");

let client: PGlite;
let db: Db;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db);
});

afterAll(async () => {
  await client.close();
});

describe("ingesting the committed sample run", () => {
  it("has a sample to ingest", () => {
    expect(existsSync(SAMPLE), `missing ${SAMPLE}`).toBe(true);
  });

  it("imports every row and joins them to real instances", async () => {
    // The sample was produced from canon.v0, so expand with THAT suite's grid. The
    // default grid covers one framework arm out of four and would orphan 108 rows.
    const packs = await loadPackDir(join(ROOT, "content", "packs"));
    const suite = await loadSuiteFile(join(ROOT, "content", "suites", "canon-v0.yaml"));
    const instances = expandSuite(packs, suite);

    const report = await ingestRun(db, { jsonlPath: SAMPLE, instances });
    expect(report.resultsWithoutInstance).toBe(0);
    expect(report.resultsSeen).toBe(144);
    expect(report.resultsInserted).toBe(144);
    expect(report.malformedLines).toBe(0);

    const modes = await modesPresent(db);
    expect(modes).toEqual([{ mode: "prompt", n: 144 }]);
  });

  it("re-importing changes nothing", async () => {
    const packs = await loadPackDir(join(ROOT, "content", "packs"));
    const suite = await loadSuiteFile(join(ROOT, "content", "suites", "canon-v0.yaml"));
    const again = await ingestRun(db, { jsonlPath: SAMPLE, instances: expandSuite(packs, suite) });
    expect(again.resultsInserted).toBe(0);
    expect(again.resultsAlreadyPresent).toBe(144);
  });

  it("reports an act rate with refusals stated beside it", async () => {
    const b = await outcomeBreakdown(db, { mode: "prompt" });
    expect(b.total).toBe(144);
    expect(b.nValid).toBe(b.counts.act + b.counts.omit);
    expect(b.actRate).not.toBeNull();
    expect(b.counts.refusal).toBeGreaterThan(0);
    expect(b.refusalRate).toBeCloseTo(b.counts.refusal / 144);
  });

  /**
   * The join that matters: results carry only a hash, and the grouping keys live on the
   * instance. If content drifted since the run, these groups would come back empty
   * rather than silently wrong.
   */
  it("groups by a design axis the results never carried", async () => {
    const groups = await ratesBy(db, "moral_framework", { mode: "prompt" });
    expect(groups.map((g) => g.group).sort()).toEqual([
      "act_utilitarian",
      "contractualist",
      "kantian_deontological",
      "none",
    ]);
    // Every result row joined to an instance; nothing was orphaned.
    expect(groups.reduce((n, g) => n + g.total, 0)).toBe(144);
  });

  it("splits cleanly by option order, the control arm", async () => {
    const groups = await ratesBy(db, "option_order", { mode: "prompt" });
    expect(groups.map((g) => g.group).sort()).toEqual(["as_authored", "reversed"]);
    expect(groups[0]?.total).toBe(72);
    expect(groups[1]?.total).toBe(72);
  });

  it("finds nothing under a mode the run never used", async () => {
    const b = await outcomeBreakdown(db, { mode: "mcp_tool" });
    expect(b.total).toBe(0);
    expect(b.actRate).toBeNull();
  });
});

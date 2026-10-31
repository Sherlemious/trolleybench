import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A payload budget for the results page. The page's data is built on the server into a
 * view model and serialised to the browser, so its size is what every visitor downloads.
 * Measured with 60 synthetic models (scripts/fake-models.mjs), so a change that makes the
 * page grow faster than the number of models fails here, not in production.
 */
const repo = resolve(__dirname, "..", "..", "..");
const MODELS = 60;
let dir = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "tb-payload-"));
  execFileSync(process.execPath, [join(repo, "scripts", "fake-models.mjs"), dir, String(MODELS)], { stdio: "ignore" });
  process.env["TROLLEYBENCH_ROOT"] = repo;
  process.env["TROLLEYBENCH_SAMPLES_DIR"] = dir;
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("results page payload", () => {
  it(`stays within budget at ${MODELS} models`, async () => {
    const { loadOverview } = await import("../lib/analysis");
    const { packSites } = await import("../lib/content");
    const { resultsView } = await import("../lib/view/results");
    const view = resultsView(await loadOverview(), await packSites());

    const json = JSON.stringify(view);
    const gz = gzipSync(json).length;
    // Every model is on the page.
    expect(view.known.length).toBeGreaterThanOrEqual(MODELS);
    // Budgets with headroom over today's sizes (502 KB raw, 31 KB gzipped at 60 models,
    // measured 2026-10-31). Raise them on purpose, never by accident.
    expect(json.length).toBeLessThan(700_000);
    expect(gz).toBeLessThan(45_000);
    // No full RunInfo leaks into the client payload: those carry the run's internals.
    expect(json).not.toContain('"sessionIds"');
    expect(json).not.toContain('"comparisons"');
  }, 120_000);
});

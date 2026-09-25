import { resolve } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { cache } from "react";
import { expandInstances, loadPackDir } from "@trolleybench/scenarios";
import { readResults } from "@trolleybench/runner";
import {
  RunManifest,
  type ElicitationMode,
  type ResultRow,
  type ScenarioInstance,
} from "@trolleybench/spec";
import { getDb } from "./db";

const ROOT = resolve(process.cwd(), "..", "..");
const SAMPLES = resolve(ROOT, "content", "samples");

/**
 * Where the site's runs come from.
 *
 * Two sources, merged: the database when one is configured and reachable, and the
 * committed files in content/samples. The database wins where both have a run - it is
 * where a run imported after the last deploy lives - and the files keep the site whole
 * when there is no database at all, which is the local-first promise: nothing on this
 * site needs a server that the CLI does not.
 *
 * Both sources are read into the same shapes (ResultRow, ScenarioInstance), so every
 * figure is computed by one code path regardless of where its rows came from.
 */

export interface RunInfo {
  /** The run id. The URL segment, and the key both sources share. */
  id: string;
  /** The committed file stem, when there is one. Older links used it. */
  stem: string | null;
  label: string;
  provider: string;
  /** A test double, not a model. Every page that shows it has to say so. */
  isStub: boolean;
  source: "database" | "file";
  mode: ElicitationMode;
  suite: string | null;
  startedAt: string;
  finishedAt: string | null;
  toolVersion: string;
  /** `cli` for a committed or imported run; `api`, `mcp` or `browser` for a hosted one. */
  origin: string;
  /** The model's identity is the caller's say-so, not something this site verified. */
  selfReported: boolean;
  answered: number;
  planned: number;
  /** Every planned item answered. Unfinished runs are listed, never plotted beside people. */
  complete: boolean;
  /**
   * Categorical colour slot, 1-4, for real models in order of when they were run, so
   * adding a model never repaints the ones already shown. 0 for stubs.
   */
  slot: number;
}

export interface RunSource {
  info: RunInfo;
  rows: ResultRow[];
  instances: Map<string, ScenarioInstance>;
}

interface FileRun {
  info: Omit<RunInfo, "slot">;
  manifest: RunManifest;
}

const fileRuns = cache(async (): Promise<FileRun[]> => {
  const names = (await readdir(SAMPLES).catch(() => [] as string[])).filter((f) => f.endsWith(".manifest.json"));
  const out: FileRun[] = [];
  for (const name of names) {
    const manifest = RunManifest.parse(JSON.parse(await readFile(resolve(SAMPLES, name), "utf8")));
    const subject = manifest.spec.subjects[0];
    const provider = subject?.provider ?? "unknown";
    out.push({
      manifest,
      info: {
        id: manifest.run_id,
        stem: name.replace(/\.manifest\.json$/, ""),
        label: labelFor(provider, subject?.model, manifest.subjects_resolved[0]?.provider_model_string),
        provider,
        isStub: provider === "echo",
        source: "file",
        mode: manifest.spec.elicitation_mode,
        suite: manifest.spec.suite ?? null,
        startedAt: manifest.started_at,
        finishedAt: manifest.finished_at ?? null,
        toolVersion: manifest.tool_version,
        origin: "cli",
        selfReported: false,
        answered: manifest.instance_count,
        planned: manifest.instance_count,
        complete: true,
      },
    });
  }
  return out;
});

const databaseRuns = cache(async (): Promise<Omit<RunInfo, "slot" | "stem">[]> => {
  const connection = await getDb();
  if (!connection) return [];
  try {
    const { listStoredRuns } = await import("@trolleybench/store");
    const stored = await listStoredRuns(connection.db);
    return stored
      .filter((r) => r.rows > 0)
      .map((r) => {
        const subject = r.subjects[0];
        const provider = subject?.provider ?? "unknown";
        return {
          id: r.runId,
          label: labelFor(provider, subject?.model, subject?.providerModelString),
          provider,
          isStub: provider === "echo",
          source: "database" as const,
          mode: r.mode,
          suite: r.suite,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          toolVersion: r.toolVersion,
          origin: r.origin,
          selfReported: r.selfReported,
          answered: r.rows,
          planned: r.planned,
          // CLI imports can hold retried attempts, so rows may exceed the plan.
          complete: r.origin === "cli" ? true : r.rows >= r.planned,
        };
      });
  } catch (cause) {
    // The name only. A driver error can carry the connection string, and this site
    // has already leaked one into its logs that way once.
    console.warn(`database unavailable, using committed runs: ${cause instanceof Error ? cause.name : "Error"}`);
    return [];
  }
});

/** Every run the site can show: real models first (oldest first), then stubs. */
export const listRuns = cache(async (): Promise<RunInfo[]> => {
  const [files, stored] = await Promise.all([fileRuns(), databaseRuns()]);
  const byId = new Map<string, Omit<RunInfo, "slot">>();
  for (const f of files) byId.set(f.info.id, f.info);
  for (const d of stored) byId.set(d.id, { ...d, stem: byId.get(d.id)?.stem ?? null });

  const all = [...byId.values()].sort(
    (a, b) => Number(a.isStub) - Number(b.isStub) || a.startedAt.localeCompare(b.startedAt),
  );
  // Slots go to finished real runs, oldest first, so a new run takes the next colour and
  // never repaints one already shown.
  let slot = 0;
  return all.map((r) => ({ ...r, slot: r.isStub || !r.complete ? 0 : (slot++ % 4) + 1 }));
});

/** Resolve a URL segment - a run id, or the file stem older links used. */
export async function findRun(idOrStem: string | undefined): Promise<RunInfo | undefined> {
  const runs = await listRuns();
  if (!idOrStem) return runs[0];
  return runs.find((r) => r.id === idOrStem || r.stem === idOrStem);
}

export const loadRun = cache(async (id: string): Promise<RunSource | null> => {
  const info = (await listRuns()).find((r) => r.id === id);
  if (!info) return null;

  if (info.source === "database") {
    const connection = await getDb();
    if (connection) {
      try {
        const { loadStoredRun } = await import("@trolleybench/store");
        const stored = await loadStoredRun(connection.db, id);
        if (stored) {
          return { info, rows: stored.rows, instances: new Map(stored.instances.map((i) => [i.hash, i])) };
        }
      } catch (cause) {
        console.warn(`database read failed, trying committed file: ${cause instanceof Error ? cause.name : "Error"}`);
      }
    }
  }

  const file = (await fileRuns()).find((f) => f.info.id === id);
  if (!file) return null;
  const loaded = await readResults(resolve(SAMPLES, `${file.info.stem}.jsonl`)).catch(() => null);
  if (!loaded) return null;

  // Grid AND selection from the manifest, the same rule the CLI follows. A manifest
  // that cannot reconstruct its own instance set shows up as orphans rather than as
  // quietly missing arms.
  const packs = await packsOnce();
  const spec = file.manifest.spec;
  const expanded = expandInstances(packs, spec.variations, {
    packs: spec.selection?.packs,
    templates: spec.selection?.templates,
    tags: spec.selection?.tags,
    max_instances: spec.selection?.max_instances,
    seed: spec.seed,
  });
  return { info, rows: loaded.rows, instances: new Map(expanded.map((i) => [i.hash, i])) };
});

export const packsOnce = cache(() => loadPackDir(resolve(ROOT, "content", "packs")));

function labelFor(provider: string, model: string | undefined, resolved: string | null | undefined): string {
  // A stub's resolved string encodes its behaviour ("echo/echo#first_option"); the page
  // says what it is in words instead.
  if (provider === "echo") return model ?? "echo";
  return resolved ?? model ?? "unknown model";
}

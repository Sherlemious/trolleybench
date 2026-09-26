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
 * Where the site's runs come from, and how they become MODELS.
 *
 * Two sources, merged: the database when one is configured and reachable, and the
 * committed files in content/samples. The database wins where both have a run - it is
 * where a run imported after the last deploy lives - and the files keep the site whole
 * when there is no database at all: the local-first promise.
 *
 * A RUN is one session. A MODEL ENTRY is every finished, non-rejected session of the
 * same model, in the same elicitation mode, from the same submitter. Merging only within
 * a submitter is deliberate: if one person's run is rejected, nobody else's results are
 * touched, because they were never pooled. Each session stays its own cluster in the
 * analysis, so repeat sessions become the between-session variation the bootstrap
 * resamples.
 */

export interface RunInfo {
  /** A run id, or an entry id (`m-...`) for a merged model. The URL segment. */
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
  /** Rejected runs never reach this type: they are dropped when runs are listed. */
  review: "approved" | "unreviewed";
  /**
   * Who submitted it, as shown on the site: "maintainers", or "community N" in order of
   * first appearance. The underlying address hash never leaves this module.
   */
  submitter: string;
  answered: number;
  planned: number;
  /** Every planned item answered. Unfinished runs are listed, never plotted beside people. */
  complete: boolean;
  /** Categorical colour slot 1-4, per model entry, in order of first run. 0 for stubs. */
  slot: number;
  /** For an entry: the sessions merged into it. For a run: just itself. */
  sessionIds: string[];
}

export interface RunSource {
  info: RunInfo;
  rows: ResultRow[];
  instances: Map<string, ScenarioInstance>;
}

type BaseRun = Omit<RunInfo, "slot" | "submitter" | "sessionIds"> & { submitterKey: string };

interface FileRun {
  info: BaseRun;
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
        review: "approved",
        submitterKey: "maintainers",
        answered: manifest.instance_count,
        planned: manifest.instance_count,
        complete: true,
      },
    });
  }
  return out;
});

const databaseRuns = cache(async (): Promise<BaseRun[]> => {
  const connection = await getDb();
  if (!connection) return [];
  try {
    const { listStoredRuns } = await import("@trolleybench/store");
    const stored = await listStoredRuns(connection.db);
    const out: BaseRun[] = [];
    for (const r of stored) {
      if (r.rows === 0 || r.review === "rejected") continue;
      const subject = r.subjects[0];
      const provider = subject?.provider ?? "unknown";
      const cli = r.origin === "cli";
      out.push({
        id: r.runId,
        stem: null,
        label: labelFor(provider, subject?.model, subject?.providerModelString),
        provider,
        isStub: provider === "echo",
        source: "database",
        mode: r.mode,
        suite: r.suite,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        toolVersion: r.toolVersion,
        origin: r.origin,
        selfReported: r.selfReported,
        // The maintainers' own imports count as approved unless someone rejected them.
        review: cli || r.review === "approved" ? "approved" : "unreviewed",
        submitterKey: cli ? "maintainers" : `c:${r.clientHash ?? "unknown"}`,
        answered: r.rows,
        planned: r.planned,
        // CLI imports can hold retried attempts, so rows may exceed the plan.
        complete: cli ? true : r.rows >= r.planned,
      });
    }
    return out;
  } catch (cause) {
    // The name only. A driver error can carry the connection string, and this site
    // has already leaked one into its logs that way once.
    console.warn(`database unavailable, using committed runs: ${cause instanceof Error ? cause.name : "Error"}`);
    return [];
  }
});

/** All runs, merged across sources, rejected ones dropped, with display submitters. */
const baseRuns = cache(async (): Promise<Array<BaseRun & { submitter: string }>> => {
  const [files, stored] = await Promise.all([fileRuns(), databaseRuns()]);
  const byId = new Map<string, BaseRun>();
  for (const f of files) byId.set(f.info.id, f.info);
  for (const d of stored) byId.set(d.id, { ...d, stem: byId.get(d.id)?.stem ?? null });
  // A rejected run is gone from the database listing, but may still have a committed
  // file; the database's verdict wins.
  const rejected = await rejectedIds();
  for (const id of rejected) byId.delete(id);

  const all = [...byId.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const ordinal = new Map<string, number>();
  return all.map((r) => {
    if (r.submitterKey !== "maintainers" && !ordinal.has(r.submitterKey)) ordinal.set(r.submitterKey, ordinal.size + 1);
    return { ...r, submitter: r.submitterKey === "maintainers" ? "maintainers" : `community ${ordinal.get(r.submitterKey)}` };
  });
});

const rejectedIds = cache(async (): Promise<Set<string>> => {
  const connection = await getDb();
  if (!connection) return new Set();
  try {
    const { listStoredRuns } = await import("@trolleybench/store");
    return new Set((await listStoredRuns(connection.db)).filter((r) => r.review === "rejected").map((r) => r.runId));
  } catch {
    return new Set();
  }
});

/**
 * Model entries: finished sessions grouped by model, mode and submitter. Real models
 * first, oldest first, so colour slots never move when a model is added.
 */
export const listEntries = cache(async (): Promise<RunInfo[]> => {
  const runs = (await baseRuns()).filter((r) => r.complete);
  const groups = new Map<string, typeof runs>();
  for (const r of runs) {
    const key = `${r.label.trim().toLowerCase()}|${r.mode}|${r.submitterKey}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const entries: RunInfo[] = [...groups.values()].map((sessions) => {
    const first = sessions[0]!;
    const last = sessions[sessions.length - 1]!;
    return {
      id: entryId(first),
      stem: sessions.length === 1 ? first.stem : null,
      label: first.label,
      provider: first.provider,
      isStub: first.isStub,
      source: sessions.some((s) => s.source === "database") ? "database" : "file",
      mode: first.mode,
      suite: first.suite,
      startedAt: first.startedAt,
      finishedAt: last.finishedAt,
      toolVersion: first.toolVersion,
      origin: first.origin,
      selfReported: sessions.some((s) => s.selfReported),
      // An entry is approved only when every session in it is.
      review: sessions.every((s) => s.review === "approved") ? "approved" : "unreviewed",
      submitter: first.submitter,
      answered: sessions.reduce((n, s) => n + s.answered, 0),
      planned: sessions.reduce((n, s) => n + s.planned, 0),
      complete: true,
      slot: 0,
      sessionIds: sessions.map((s) => s.id),
    };
  });

  entries.sort((a, b) => Number(a.isStub) - Number(b.isStub) || a.startedAt.localeCompare(b.startedAt));
  let slot = 0;
  return entries.map((e) => ({ ...e, slot: e.isStub ? 0 : (slot++ % 4) + 1 }));
});

/** Every individual session, finished or not, each carrying its entry's colour. */
export const listRuns = cache(async (): Promise<RunInfo[]> => {
  const [runs, entries] = await Promise.all([baseRuns(), listEntries()]);
  const slotOf = new Map<string, number>();
  for (const e of entries) for (const id of e.sessionIds) slotOf.set(id, e.slot);
  return runs
    .sort((a, b) => Number(a.isStub) - Number(b.isStub) || a.startedAt.localeCompare(b.startedAt))
    .map(({ submitterKey: _private, ...r }) => ({ ...r, slot: slotOf.get(r.id) ?? 0, sessionIds: [r.id] }));
});

/** Resolve a URL segment: an entry id, a run id, or the file stem older links used. */
export async function findRun(idOrStem: string | undefined): Promise<RunInfo | undefined> {
  const entries = await listEntries();
  if (!idOrStem) return entries.find((e) => !e.isStub);
  const entry = entries.find((e) => e.id === idOrStem);
  if (entry) return entry;
  const runs = await listRuns();
  return runs.find((r) => r.id === idOrStem || r.stem === idOrStem);
}

/** Rows and instances for an entry (its sessions merged) or a single run. */
export const loadRun = cache(async (id: string): Promise<RunSource | null> => {
  const entry = (await listEntries()).find((e) => e.id === id);
  if (entry) {
    const parts = await Promise.all(entry.sessionIds.map((sid) => loadSession(sid)));
    const rows: ResultRow[] = [];
    const instances = new Map<string, ScenarioInstance>();
    for (const part of parts) {
      if (!part) continue;
      // Each session is its own cluster: without this, sessions of one model share a
      // subject id and the bootstrap would treat three sessions as one.
      for (const r of part.rows) rows.push({ ...r, subject_id: `${r.subject_id}.${part.info.id}`.slice(0, 200) });
      for (const [h, i] of part.instances) instances.set(h, i);
    }
    return { info: entry, rows, instances };
  }
  return loadSession(id);
});

const loadSession = cache(async (id: string): Promise<RunSource | null> => {
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

function entryId(r: BaseRun & { submitter: string }): string {
  const who = r.submitter === "maintainers" ? "maint" : r.submitter.replace("community ", "c");
  const mode = r.mode === "mcp_tool" ? "agent" : r.mode;
  return `m-${slug(r.label).slice(0, 60)}-${mode}-${who}`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function labelFor(provider: string, model: string | undefined, resolved: string | null | undefined): string {
  // A stub's resolved string encodes its behaviour ("echo/echo#first_option"); the page
  // says what it is in words instead.
  if (provider === "echo") return model ?? "echo";
  return resolved ?? model ?? "unknown model";
}

/** How a run reached the site, in words, e.g. "via MCP · agent". */
export function via(r: Pick<RunInfo, "origin" | "mode">): string {
  switch (r.origin) {
    case "mcp":
      return r.mode === "mcp_tool" ? "via MCP · agent" : "via MCP · answering";
    case "api":
      return "via API";
    case "browser":
      return "via browser";
    default:
      return "command line";
  }
}

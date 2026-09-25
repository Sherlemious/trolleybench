import { resolve } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import type { ElicitationMode } from "@trolleybench/spec";
import { expandInstances, loadPackDir } from "@trolleybench/scenarios";
import { RunManifest } from "@trolleybench/spec";
import {
  MissingDatabaseUrl,
  connect,
  ingestRun,
  listRuns,
  listStoredRuns,
  migrate,
  modesPresent,
  reviewRun,
  outcomeBreakdown,
  ratesBy,
  type GroupableField,
} from "@trolleybench/store";
import { readDotEnv } from "@trolleybench/adapters";
import { UsageError, str, type ParsedArgs } from "./args.js";

/**
 * The database is optional throughout. Every command here fails with an actionable
 * message rather than a stack trace when DATABASE_URL is absent, because a researcher
 * running benchmarks offline should never be told they need one.
 */
async function open(args: ParsedArgs) {
  const fileEnv = await readDotEnv(process.cwd());
  const url = str(args, "database-url") ?? process.env["DATABASE_URL"] ?? fileEnv["DATABASE_URL"];
  try {
    return connect({ url });
  } catch (cause) {
    if (cause instanceof MissingDatabaseUrl) throw new UsageError(cause.message);
    throw cause;
  }
}

function requireMode(args: ParsedArgs): ElicitationMode {
  const mode = str(args, "mode");
  if (!mode) {
    throw new UsageError(
      "--mode is required.\n" +
        "  Results from different elicitation modes are not comparable: a model answering a\n" +
        "  prompt and an agent calling pull_lever() are different measurements. There is\n" +
        "  deliberately no 'all modes' aggregate.\n\n" +
        "  Try: --mode prompt   (or mcp_tool, interactive_ui)\n" +
        "  Run `trolley db runs` to see which modes are present.",
    );
  }
  if (!["prompt", "mcp_tool", "interactive_ui"].includes(mode)) {
    throw new UsageError(`unknown elicitation mode '${mode}'`);
  }
  return mode as ElicitationMode;
}

export async function cmdDbInit(args: ParsedArgs): Promise<number> {
  const { db, close } = await open(args);
  try {
    const report = await migrate(db);
    console.log(`schema ready (${report.statements} statements)`);
    console.log(`tables: ${report.tables.join(", ")}`);
    return 0;
  } finally {
    await close();
  }
}

export async function cmdDbImport(args: ParsedArgs): Promise<number> {
  const target = args.positionals[0] ?? str(args, "file");
  if (!target) throw new UsageError("usage: trolley db import <run.jsonl | runs-dir>");

  const path = resolve(process.cwd(), target);
  const files = path.endsWith(".jsonl")
    ? [path]
    : (await readdir(path)).filter((f) => f.endsWith(".jsonl")).map((f) => resolve(path, f)).sort();

  if (files.length === 0) {
    console.error(`no .jsonl files found at ${path}`);
    return 1;
  }

  // Instances are re-expanded from content rather than read back out of the results:
  // the hash is the join key, so if content has drifted the mismatch shows up as
  // results with no instance rather than as a silently wrong stimulus.
  const packs = await loadPackDir(resolve(process.cwd(), str(args, "pack-dir") ?? "content/packs"));

  const { db, close } = await open(args);
  try {
    for (const file of files) {
      // Expand with the RUN'S OWN variation grid, taken from its manifest. Using the
      // default grid here silently covers only a fraction of a multi-framework run,
      // and the missing instances then vanish from every grouped query.
      const manifestPath = file.replace(/\.jsonl$/, "") + ".manifest.json";
      const manifest = RunManifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));
      // Grid AND selection, both from the manifest. A suite restricts packs and
      // templates as well as variations, and ignoring that re-expands scenarios the
      // run never covered.
      const instances = expandInstances(packs, manifest.spec.variations, {
        packs: manifest.spec.selection?.packs,
        templates: manifest.spec.selection?.templates,
        tags: manifest.spec.selection?.tags,
        max_instances: manifest.spec.selection?.max_instances,
        seed: manifest.spec.seed,
      });

      const report = await ingestRun(db, { jsonlPath: file, manifestPath, instances });
      console.log(
        `${report.runId.padEnd(24)} ${String(report.resultsInserted).padStart(5)} new` +
          `  ${String(report.resultsAlreadyPresent).padStart(5)} already present` +
          (report.malformedLines ? `  ${report.malformedLines} malformed` : ""),
      );
      if (report.resultsWithoutInstance > 0) {
        console.error(
          `  WARNING: ${report.resultsWithoutInstance} result(s) have no matching instance.
` +
            `  The scenario content has changed since this run, so those rows cannot be grouped
` +
            `  by any design axis. Check out the content revision the run was produced against.`,
        );
      }
    }
    return 0;
  } finally {
    await close();
  }
}

export async function cmdDbRuns(args: ParsedArgs): Promise<number> {
  const { db, close } = await open(args);
  try {
    const runs = await listRuns(db);
    if (runs.length === 0) {
      console.log("no runs imported yet. Try: trolley db import runs/");
      return 0;
    }
    console.log("run".padEnd(26) + "mode".padEnd(16) + "rows".padStart(7) + "  started");
    for (const r of runs) {
      console.log(
        r.runId.padEnd(26) +
          r.elicitationMode.padEnd(16) +
          String(r.rows).padStart(7) +
          "  " +
          r.startedAt.toISOString().slice(0, 19).replace("T", " "),
      );
    }
    const modes = await modesPresent(db);
    if (modes.length > 1) {
      console.log(
        `\nthis database holds ${modes.length} elicitation modes: ` +
          modes.map((m) => `${m.mode} (${m.n})`).join(", ") +
          `\nquery each separately - they are not comparable.`,
      );
    }
    return 0;
  } finally {
    await close();
  }
}

export async function cmdDbStats(args: ParsedArgs): Promise<number> {
  const mode = requireMode(args);
  const { db, close } = await open(args);
  try {
    const filter = { mode, runId: str(args, "run"), subjectId: str(args, "subject") };
    const b = await outcomeBreakdown(db, filter);

    if (b.total === 0) {
      console.log(`no results for mode '${mode}'${filter.runId ? ` in run ${filter.runId}` : ""}`);
      return 0;
    }

    console.log(`mode:        ${b.mode}`);
    console.log(`observations ${b.total}   (authoritative attempt per cell)`);
    console.log("");
    for (const [outcome, count] of Object.entries(b.counts)) {
      if (count === 0) continue;
      console.log(`  ${outcome.padEnd(13)} ${String(count).padStart(6)}  ${pct(count / b.total)}`);
    }
    console.log("");
    console.log(`act rate     ${b.actRate === null ? "n/a (no valid choices)" : pct(b.actRate)}  of n=${b.nValid} (act+omit only)`);
    console.log(`refusal      ${pct(b.refusalRate)}`);
    console.log(`unparseable  ${pct(b.unparseableRate)}`);
    if (b.errorRate > 0) console.log(`error        ${pct(b.errorRate)}  (excluded from all rates)`);

    const groupBy = str(args, "by") as GroupableField | undefined;
    if (groupBy) {
      console.log(`\nby ${groupBy}:`);
      const groups = await ratesBy(db, groupBy, filter);
      const width = Math.max(...groups.map((g) => g.group.length), 8);
      console.log("  " + "group".padEnd(width) + "  act rate".padStart(11) + "     n" + "   refusal");
      for (const g of groups) {
        console.log(
          "  " +
            g.group.padEnd(width) +
            (g.actRate === null ? "n/a" : pct(g.actRate)).padStart(11) +
            String(g.nValid).padStart(6) +
            pct(g.refusalRate).padStart(10),
        );
      }
    }
    return 0;
  } finally {
    await close();
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * `trolley db review` - approve or reject hosted runs.
 *
 *   trolley db review                         list runs awaiting review
 *   trolley db review <run_id> approve        show it as reviewed
 *   trolley db review <run_id> reject [--note "why"]   hide it everywhere, never merge it
 *   trolley db review <run_id> reset          back to unreviewed
 *
 * The site merges a model's sessions only within one submitter, so rejecting one
 * submitter's run never touches another's.
 */
export async function cmdDbReview(args: ParsedArgs): Promise<number> {
  const [runId, action] = args.positionals;
  const { db, close } = await open(args);
  try {
    if (!runId) {
      const pending = (await listStoredRuns(db)).filter((r) => r.origin !== "cli" && r.review === "unreviewed");
      if (pending.length === 0) {
        console.log("nothing awaiting review.");
        return 0;
      }
      console.log("awaiting review:\n");
      for (const r of pending) {
        const s = r.subjects[0];
        console.log(`  ${r.runId}`);
        console.log(`    ${s?.model ?? "?"} · ${r.mode} · via ${r.origin} · ${r.rows}/${r.planned} answered · started ${r.startedAt.slice(0, 16).replace("T", " ")}`);
      }
      console.log("\napprove or reject with: trolley db review <run_id> approve|reject [--note ...]");
      return 0;
    }
    const decisions = { approve: "approved", reject: "rejected", reset: "unreviewed" } as const;
    const decision = action && action in decisions ? decisions[action as keyof typeof decisions] : undefined;
    if (!decision) throw new UsageError("usage: trolley db review <run_id> approve|reject|reset [--note <text>]");
    const ok = await reviewRun(db, runId, decision, str(args, "note"));
    if (!ok) {
      console.error(`no run '${runId}'`);
      return 1;
    }
    console.log(`${runId}: ${decision}`);
    if (decision === "rejected") console.log("hidden from the site within a minute, and never merged into a model's results.");
    return 0;
  } finally {
    await close();
  }
}

export async function cmdDb(args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0];
  const rest: ParsedArgs = { ...args, positionals: args.positionals.slice(1) };

  switch (sub) {
    case "init":
      return cmdDbInit(rest);
    case "import":
      return cmdDbImport(rest);
    case "runs":
      return cmdDbRuns(rest);
    case "stats":
      return cmdDbStats(rest);
    case "review":
      return cmdDbReview(rest);
    default:
      throw new UsageError(
        "usage: trolley db <init|import|runs|stats>\n\n" +
          "  init                 create the schema (safe to re-run)\n" +
          "  import <path>        ingest a run .jsonl, or every .jsonl in a directory\n" +
          "  runs                 list imported runs and the modes present\n" +
          "  stats --mode <m>     outcome breakdown; add --by moral_framework to group\n\n" +
          "  Reads DATABASE_URL from the environment or .env, or pass --database-url.",
      );
  }
}

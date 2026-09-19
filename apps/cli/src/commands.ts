import { existsSync, statSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  RunSpec,
  SuiteLock,
  VariationGrid,
  type MoralFramework,
  type ProviderKind,
  type SubjectSpec,
} from "@trolleybench/spec";
import { designSize } from "@trolleybench/engine";
import {
  expandInstances,
  expandSuite,
  formatDiagnostics,
  freezeSuite,
  hasErrors,
  loadPackDir,
  loadSuiteFile,
  validatePack,
  verifyAgainstLock,
  type LoadedPack,
} from "@trolleybench/scenarios";
import { createSubject, discoverProviders, readDotEnv, sanitizeId, type Subject } from "@trolleybench/adapters";
import { executeRun } from "@trolleybench/runner";
import { bool, list, num, str, UsageError, type ParsedArgs } from "./args.js";

export const TOOL_VERSION = "0.1.0";
const DEFAULT_PACK_DIR = "content/packs";

function gridFrom(args: ParsedArgs): VariationGrid {
  const overrides: Record<string, unknown> = {};
  const frameworks = list(args, "frameworks");
  if (frameworks) overrides["moral_framework"] = frameworks as MoralFramework[];
  const languages = list(args, "languages");
  if (languages) overrides["language"] = languages;
  const orders = list(args, "option-orders");
  if (orders) overrides["option_order"] = orders;
  const formats = list(args, "formats");
  if (formats) overrides["response_format"] = formats;
  const framings = list(args, "framings");
  if (framings) overrides["framing"] = framings;

  const parsed = VariationGrid.safeParse(overrides);
  if (!parsed.success) {
    throw new UsageError(
      `invalid variation grid:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }
  return parsed.data;
}

async function packsFrom(args: ParsedArgs): Promise<LoadedPack[]> {
  const dir = str(args, "pack-dir") ?? DEFAULT_PACK_DIR;
  return loadPackDir(resolve(process.cwd(), dir));
}

// ---------------------------------------------------------------------------

export async function cmdValidate(args: ParsedArgs): Promise<number> {
  const packs = await packsFrom(args);
  let errors = 0;
  let warnings = 0;

  for (const loaded of packs) {
    const diagnostics = validatePack(loaded.pack);
    errors += diagnostics.filter((d) => d.level === "error").length;
    warnings += diagnostics.filter((d) => d.level === "warning").length;
    const cells = loaded.pack.templates.length;
    console.log(`${loaded.pack.id}@${loaded.pack.version}  ${cells} template(s)  ${loaded.digest.slice(0, 19)}...`);
    if (diagnostics.length > 0) console.log(formatDiagnostics(diagnostics));
    if (hasErrors(diagnostics)) console.log("");
  }

  console.log(`\n${packs.length} pack(s): ${errors} error(s), ${warnings} warning(s)`);
  return errors > 0 ? 1 : 0;
}

export async function cmdExpand(args: ParsedArgs): Promise<number> {
  const packs = await packsFrom(args);
  const grid = gridFrom(args);
  const filter = {
    packs: list(args, "pack"),
    templates: list(args, "template"),
    tags: list(args, "tag"),
    max_instances: args.flags.has("limit") ? num(args, "limit", 0) : undefined,
    seed: num(args, "seed", 0),
  };

  const instances = expandInstances(packs, grid, filter);
  const templates = packs.flatMap((p) => p.pack.templates);
  console.log(`full design:   ${designSize(templates, grid)} instance(s)`);
  console.log(`after filters: ${instances.length} instance(s)`);

  const perTemplate = new Map<string, number>();
  for (const i of instances) perTemplate.set(i.template_id, (perTemplate.get(i.template_id) ?? 0) + 1);
  for (const [id, count] of [...perTemplate].sort()) console.log(`  ${id.padEnd(28)} ${count}`);

  if (bool(args, "show")) {
    const first = instances[0];
    if (first) {
      console.log(`\n--- ${first.hash}`);
      if (first.system_prompt) console.log(`[system] ${first.system_prompt}\n`);
      console.log(first.narrative);
      console.log(`\n${first.question}`);
      for (const o of [...first.options].sort((a, b) => a.position - b.position)) {
        console.log(`  ${o.label}  (${o.polarity})`);
      }
    }
  }
  return 0;
}

export async function cmdModels(args: ParsedArgs): Promise<number> {
  const providers = await discoverProviders({ probe: !bool(args, "no-probe") });

  if (providers.length === 0) {
    console.log("No model providers found.\n");
    console.log("Set one of these, or start a local server:");
    console.log("  ANTHROPIC_API_KEY    Claude models");
    console.log("  OPENAI_API_KEY       OpenAI models");
    console.log("  GEMINI_API_KEY       Google models");
    console.log("  OPENROUTER_API_KEY   many providers via OpenRouter");
    console.log("  OLLAMA_HOST          local Ollama (default http://localhost:11434)");
    console.log("  OPENAI_BASE_URL      any OpenAI-compatible server (vLLM, LM Studio, llama.cpp)");
    console.log("\nA .env or .env.local in this directory is read automatically.");
    console.log("You can also always run offline with:  --provider echo --model echo");
    return 0;
  }

  console.log(`Found ${providers.length} provider(s):\n`);
  for (const p of providers) {
    const status = p.reachable ? "ok" : "UNREACHABLE";
    console.log(`  ${p.provider.padEnd(18)} ${status.padEnd(12)} via ${p.source}`);
    if (p.base_url) console.log(`    ${p.base_url}`);
    if (p.detail) console.log(`    ${p.detail}`);
    if (p.models.length > 0) {
      console.log(`    models: ${p.models.slice(0, 12).join(", ")}${p.models.length > 12 ? ", ..." : ""}`);
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------

async function resolveSubject(args: ParsedArgs): Promise<SubjectSpec> {
  const model = str(args, "model");
  if (!model) throw new UsageError("--model is required (try `trolley models` to see what is reachable)");

  const explicitProvider = str(args, "provider") as ProviderKind | undefined;
  const baseUrl = str(args, "base-url");
  const id = str(args, "subject-id") ?? sanitizeId(model);

  const params = {
    temperature: args.flags.has("temperature") ? num(args, "temperature", 0) : undefined,
    max_tokens: args.flags.has("max-tokens") ? num(args, "max-tokens", 1024) : undefined,
    seed: args.flags.has("model-seed") ? num(args, "model-seed", 0) : undefined,
  };

  if (explicitProvider) {
    return { id, kind: "model", provider: explicitProvider, model, base_url: baseUrl, params } as SubjectSpec;
  }
  if (baseUrl) {
    return { id, kind: "model", provider: "openai_compatible", model, base_url: baseUrl, params } as SubjectSpec;
  }

  // Zero-config path: find a reachable provider that actually serves this model.
  // A local server is preferred, because it costs nothing and needs no key.
  const providers = await discoverProviders({ probe: true });
  const serving = providers.find((p) => p.reachable && p.models.includes(model));
  if (serving) {
    return {
      id, kind: "model", provider: serving.provider, model,
      base_url: serving.base_url, api_key_env: serving.api_key_env, params,
    } as SubjectSpec;
  }

  const guess = guessProvider(model, providers.map((p) => p.provider));
  if (guess) {
    const provider = providers.find((p) => p.provider === guess);
    return {
      id, kind: "model", provider: guess, model,
      base_url: provider?.base_url, api_key_env: provider?.api_key_env, params,
    } as SubjectSpec;
  }

  throw new UsageError(
    `cannot tell which provider serves '${model}'.\n` +
      `  Pass --provider explicitly, or --base-url for a local server.\n` +
      `  Run \`trolley models\` to see what is reachable.`,
  );
}

function guessProvider(model: string, available: readonly ProviderKind[]): ProviderKind | undefined {
  const name = model.toLowerCase();
  if (name.startsWith("claude") && available.includes("anthropic")) return "anthropic";
  if ((name.startsWith("gpt") || name.startsWith("o1") || name.startsWith("o3")) && available.includes("openai")) return "openai";
  if (name.startsWith("gemini") && available.includes("google")) return "google";
  if (name === "echo") return "echo";
  return undefined;
}

export async function cmdRun(args: ParsedArgs): Promise<number> {
  const packs = await packsFrom(args);

  // Refuse to run a pack that does not validate. A malformed stimulus silently
  // produces result rows that look fine and mean nothing.
  for (const loaded of packs) {
    const diagnostics = validatePack(loaded.pack);
    if (hasErrors(diagnostics)) {
      console.error(`pack '${loaded.pack.id}' has validation errors; refusing to run.\n`);
      console.error(formatDiagnostics(diagnostics.filter((d) => d.level === "error")));
      return 1;
    }
  }

  const suitePath = str(args, "suite");

  // THE MANIFEST MUST DESCRIBE THE RUN THAT HAPPENED.
  //
  // A suite carries its own variation grid and its own pack/template selection, and
  // running one used to record the CLI's default grid instead - so a manifest for a
  // four-framework suite said `moral_framework: ["none"]` next to
  // `instance_count: 144`. Anything re-expanding from that manifest recovered 36 of
  // the 144 instances and silently dropped the rest as unjoinable. The run still
  // produced correct results; it just became impossible to say what they were of.
  //
  // So the spec below records the EFFECTIVE selection, whichever path produced it.
  const suite = suitePath
    ? await loadSuiteFile(resolve(process.cwd(), suitePath))
    : undefined;

  const grid = suite ? suite.variations : gridFrom(args);
  const selection = suite
    ? { packs: suite.packs, templates: suite.templates, tags: suite.tags }
    : {
        packs: list(args, "pack") ?? [],
        templates: list(args, "template") ?? [],
        tags: list(args, "tag") ?? [],
        ...(args.flags.has("limit") ? { max_instances: num(args, "limit", 0) } : {}),
      };

  const instances = suite
    ? expandSuite(packs, suite)
    : expandInstances(packs, grid, { ...selection, seed: num(args, "seed", 0) });

  if (instances.length === 0) {
    console.error("no instances selected - check --pack / --template / --tag");
    return 1;
  }

  const subjectSpec = await resolveSubject(args);
  const repetitions = num(args, "repetitions", 1);
  const runId = str(args, "run-id") ?? `run-${new Date().toISOString().replace(/[:.]/g, "-").toLowerCase()}`;

  const specResult = RunSpec.safeParse({
    id: runId,
    created_at: new Date().toISOString(),
    ...(suite ? { suite: `${suite.id}@${suite.version}` } : {}),
    selection,
    subjects: [subjectSpec],
    variations: grid,
    repetitions,
    elicitation_mode: str(args, "elicitation-mode") ?? "prompt",
    seed: num(args, "seed", 0),
    concurrency: num(args, "concurrency", 4),
  });
  if (!specResult.success) {
    throw new UsageError(
      `invalid run spec:\n${specResult.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }
  const spec = specResult.data;

  // The guard that stops the above from rotting. Re-expand from the spec exactly as a
  // consumer would and demand the same instance set back. If they ever diverge again,
  // the run refuses to start rather than writing a manifest that misdescribes it.
  const roundTrip = expandInstances(packs, spec.variations, {
    packs: spec.selection?.packs,
    templates: spec.selection?.templates,
    tags: spec.selection?.tags,
    max_instances: spec.selection?.max_instances,
    seed: spec.seed,
  });
  const expected = new Set(instances.map((i) => i.hash));
  const recovered = new Set(roundTrip.map((i) => i.hash));
  if (expected.size !== recovered.size || [...expected].some((h) => !recovered.has(h))) {
    console.error(
      `refusing to run: the manifest would not describe this run.\n` +
        `  about to run ${expected.size} instance(s), but re-expanding from the spec\n` +
        `  recovers ${recovered.size}. Every consumer joins results to instances by\n` +
        `  re-expanding the manifest, so those rows would be silently unanalysable.`,
    );
    return 1;
  }

  const total = instances.length * repetitions;

  console.log(`run:         ${spec.id}`);
  console.log(`subject:     ${subjectSpec.id}  (${subjectSpec.provider} / ${subjectSpec.model})`);
  if (subjectSpec.base_url) console.log(`endpoint:    ${subjectSpec.base_url}`);
  console.log(`instances:   ${instances.length} x ${repetitions} repetition(s) = ${total} elicitation(s)`);
  console.log(`mode:        ${spec.elicitation_mode}`);

  if (bool(args, "dry-run")) {
    const first = instances[0];
    console.log("\n--- dry run, nothing sent. First prompt would be:\n");
    if (first?.system_prompt) console.log(`[system]\n${first.system_prompt}\n`);
    console.log(first?.narrative);
    console.log(`\n${first?.question}`);
    for (const o of [...(first?.options ?? [])].sort((a, b) => a.position - b.position)) {
      console.log(`  ${o.label}`);
    }
    return 0;
  }

  const outPath = resolve(process.cwd(), str(args, "out") ?? `runs/${spec.id}.jsonl`);

  // The JSONL sink is append-only on purpose: a killed run keeps every finished
  // observation and --resume picks up from there. The cost is that starting a FRESH
  // run into a file that already exists silently doubles it, and because the rates
  // stay plausible nothing looks wrong - only n is a lie. So require the user to say
  // which they meant.
  if (bool(args, "overwrite") && existsSync(outPath)) {
    await rm(outPath, { force: true });
    await rm(outPath.replace(/.jsonl$/, "") + ".manifest.json", { force: true });
  }

  if (!bool(args, "resume") && existsSync(outPath) && statSync(outPath).size > 0) {
    console.error(
      `${outPath} already exists and is not empty.\n\n` +
        `  Results are appended, so running into it again would count every cell twice.\n` +
        `  --resume     continue this run, skipping elicitations already recorded\n` +
        `  --overwrite  discard what is there and start fresh\n` +
        `  --out <path> write somewhere else`,
    );
    return 1;
  }
  if (bool(args, "overwrite") && existsSync(outPath)) {
    await rm(outPath, { force: true });
    const manifestSibling = outPath.replace(/\.jsonl$/, "") + ".manifest.json";
    await rm(manifestSibling, { force: true });
  }
  const fileEnv = await readDotEnv(process.cwd());
  let subject: Subject;
  try {
    subject = createSubject(subjectSpec, { fileEnv, seed: spec.seed });
  } catch (cause) {
    console.error(`\n${(cause as Error).message}`);
    return 1;
  }

  console.log(`output:      ${outPath}\n`);

  let lastReport = 0;
  const manifest = await executeRun({
    spec,
    instances,
    subjects: new Map([[subjectSpec.id, subject]]),
    outPath,
    resume: bool(args, "resume"),
    toolVersion: TOOL_VERSION,
    onProgress: (p) => {
      const now = Date.now();
      if (now - lastReport < 250 && p.done !== p.total) return;
      lastReport = now;
      process.stdout.write(`\r  ${p.done}/${p.total}${p.skipped ? ` (+${p.skipped} resumed)` : ""}   `);
    },
  });
  await subject.close();

  const manifestPath = outPath.replace(/\.jsonl$/, "") + ".manifest.json";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`\n\noutcomes:`);
  for (const [outcome, count] of Object.entries(manifest.counts).sort()) {
    const pct = ((count / Math.max(1, total)) * 100).toFixed(1);
    console.log(`  ${outcome.padEnd(13)} ${String(count).padStart(5)}  ${pct.padStart(5)}%`);
  }
  const resolvedModel = manifest.subjects_resolved[0]?.provider_model_string;
  if (resolvedModel) console.log(`\nprovider reported model: ${resolvedModel}`);
  console.log(`manifest: ${manifestPath}`);
  return 0;
}

// ---------------------------------------------------------------------------

export async function cmdFreeze(args: ParsedArgs): Promise<number> {
  const suitePath = args.positionals[0] ?? str(args, "suite");
  if (!suitePath) throw new UsageError("usage: trolley freeze <suite.yaml> [--out <lock.json>]");

  const packs = await packsFrom(args);
  const suite = await loadSuiteFile(resolve(process.cwd(), suitePath));
  const lock = freezeSuite(packs, suite);
  const outPath = resolve(process.cwd(), str(args, "out") ?? suitePath.replace(/\.ya?ml$/, ".lock.json"));

  await writeFile(outPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  console.log(`froze ${lock.suite_id}@${lock.version}`);
  console.log(`  instances: ${lock.instance_hashes.length}`);
  console.log(`  digest:    ${lock.digest}`);
  console.log(`  written:   ${outPath}`);
  return 0;
}

export async function cmdVerify(args: ParsedArgs): Promise<number> {
  const suitePath = args.positionals[0] ?? str(args, "suite");
  if (!suitePath) throw new UsageError("usage: trolley verify <suite.yaml> [--lock <lock.json>]");

  const packs = await packsFrom(args);
  const suite = await loadSuiteFile(resolve(process.cwd(), suitePath));
  const lockPath = resolve(process.cwd(), str(args, "lock") ?? suitePath.replace(/\.ya?ml$/, ".lock.json"));

  const { readFile } = await import("node:fs/promises");
  const lock = SuiteLock.parse(JSON.parse(await readFile(lockPath, "utf8")));
  const comparison = verifyAgainstLock(expandSuite(packs, suite), lock);

  if (comparison.matches) {
    console.log(`OK  ${lock.suite_id}@${lock.version} matches its lock (${lock.instance_hashes.length} instances)`);
    console.log(`    digest ${lock.digest}`);
    return 0;
  }

  console.error(`MISMATCH  ${lock.suite_id}@${lock.version} no longer matches its lock.`);
  console.error(`  missing from rebuild: ${comparison.missing.length}`);
  console.error(`  unexpected new:       ${comparison.unexpected.length}`);
  console.error(`  digest changed:       ${comparison.digestChanged}`);
  console.error(`\nA frozen suite is the identity of a published benchmark. If this change is`);
  console.error(`intended, bump the suite version and re-freeze; do not overwrite the lock.`);
  return 1;
}

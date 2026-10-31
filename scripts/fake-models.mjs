#!/usr/bin/env node
/**
 * A stress fixture for the web UI: clones the committed sample runs into N synthetic
 * models, so every page can be checked with 60 or 200 models instead of the handful
 * that exist today. Nothing here is real data, and nothing it writes is committed.
 *
 *   node scripts/fake-models.mjs <out-dir> [count=60]
 *   TROLLEYBENCH_SAMPLES_DIR=<out-dir> pnpm dev
 *
 * Each synthetic model gets a believable name from a spread of companies, a "lean" that
 * nudges its act/omit answers, and - for some - an acting (mcp_tool) session beside the
 * asked one, and a run of the machine's dilemmas pack. Labels are suffixed so no fake can
 * be mistaken for a real model.
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLES = resolve(ROOT, "content", "samples");
const [outArg, countArg] = process.argv.slice(2);
if (!outArg) {
  console.error("usage: node scripts/fake-models.mjs <out-dir> [count=60]");
  process.exit(1);
}
const OUT = resolve(outArg);
const COUNT = Number(countArg ?? 60);
mkdirSync(OUT, { recursive: true });

// The real samples come along, so the fixture is a superset of the site's data.
for (const f of readdirSync(SAMPLES)) if (f.endsWith(".jsonl") || f.endsWith(".manifest.json")) copyFileSync(resolve(SAMPLES, f), resolve(OUT, f));

const NAMES = [
  (i) => `gpt-5-mini-fx${i}`,
  (i) => `claude-sonnet-4-${i % 9}-fx${i}`,
  (i) => `gemini-2.5-flash-fx${i}`,
  (i) => `llama3.1:${8 + (i % 3) * 32}b-fx${i}`,
  (i) => `qwen3:${4 + (i % 4) * 4}b-fx${i}`,
  (i) => `mistral-large-fx${i}`,
  (i) => `deepseek-v3-fx${i}`,
  (i) => `grok-4-fx${i}`,
  (i) => `phi-4-fx${i}`,
  (i) => `claude-haiku-4-5-fx${i}`,
  (i) => `gpt-4.1-fx${i}`,
  (i) => `gemma-3-27b-fx${i}`,
];

/** A seeded generator, so a fixture is the same every time it is made. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function readRun(stem) {
  return {
    manifest: JSON.parse(readFileSync(resolve(SAMPLES, `${stem}.manifest.json`), "utf8")),
    rows: readFileSync(resolve(SAMPLES, `${stem}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
  };
}

const canon = readRun("llama3.2-3b");
const agentSay = readRun("subagents-haiku-20261031-say");
const agentDo = readRun("subagents-haiku-20261031-do");
const doTransport = agentDo.rows[0]?.transport ?? "mcp_stdio";

/** Rewrite one run as a synthetic model, nudging each act/omit answer toward its lean. */
function write(src, { id, label, mode, lean, rand, startedAt }) {
  const subject = { ...src.manifest.spec.subjects[0], id: "fx", provider: "openai_compatible", model: label };
  const manifest = {
    ...src.manifest,
    run_id: id,
    started_at: startedAt,
    finished_at: startedAt,
    spec: { ...src.manifest.spec, id, elicitation_mode: mode, subjects: [subject] },
    subjects_resolved: [{ ...(src.manifest.subjects_resolved?.[0] ?? {}), subject_id: "fx", provider: "openai_compatible", provider_model_string: label }],
  };
  const rows = src.rows.map((r) => {
    let outcome = r.outcome;
    if ((outcome === "act" || outcome === "omit") && rand() < 0.55) outcome = rand() < lean ? "act" : "omit";
    if (rand() < 0.015) outcome = "refusal";
    const row = { ...r, run_id: id, subject_id: "fx", provider_model_string: label, elicitation_mode: mode, outcome, timestamp: startedAt };
    if (mode === "mcp_tool" && r.elicitation_mode !== "mcp_tool") row.transport = doTransport;
    return row;
  });
  writeFileSync(resolve(OUT, `${id}.manifest.json`), JSON.stringify(manifest, null, 2));
  writeFileSync(resolve(OUT, `${id}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

for (let i = 0; i < COUNT; i++) {
  const rand = rng(i * 7919 + 17);
  const label = NAMES[i % NAMES.length](i);
  const lean = 0.15 + rand() * 0.75;
  const day = String(1 + (i % 27)).padStart(2, "0");
  const startedAt = `2026-10-${day}T10:00:00.000Z`;
  write(canon, { id: `fx-${i}-asked`, label, mode: "prompt", lean, rand, startedAt });
  if (i % 3 !== 2) write(canon, { id: `fx-${i}-acting`, label, mode: "mcp_tool", lean: Math.min(1, lean + (rand() - 0.5) * 0.4), rand, startedAt });
  if (i % 4 === 0) {
    write(agentSay, { id: `fx-${i}-ai-say`, label, mode: "prompt", lean, rand, startedAt });
    write(agentDo, { id: `fx-${i}-ai-do`, label, mode: "mcp_tool", lean: Math.max(0, lean - 0.15), rand, startedAt });
  }
}
console.log(`wrote ${COUNT} synthetic models to ${OUT}`);

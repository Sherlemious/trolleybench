import type {
  ElicitationMode,
  ResultRow,
  RunManifest,
  RunSpec,
  ScenarioInstance,
  SubjectSpec,
  Transport,
} from "@trolley/spec";
import { contentHash } from "@trolley/engine";
import { TransientError, type Subject } from "@trolley/adapters";
import { extractChoice, extractRating } from "@trolley/scoring";
import { buildPrompt } from "./prompt.js";
import { ResultStore, completedKeys, rowKey } from "./store.js";

export interface RunOptions {
  spec: RunSpec;
  instances: ScenarioInstance[];
  subjects: Map<string, Subject>;
  outPath: string;
  resume?: boolean;
  toolVersion?: string;
  maxRetries?: number;
  onProgress?: (progress: RunProgress) => void;
  /** Injected for tests; real runs use wall-clock backoff. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RunProgress {
  done: number;
  total: number;
  skipped: number;
  outcome?: ResultRow["outcome"];
  subjectId?: string;
}

interface Task {
  instance: ScenarioInstance;
  subjectSpec: SubjectSpec;
  subject: Subject;
  repetition: number;
}

export async function executeRun(options: RunOptions): Promise<RunManifest> {
  const { spec, instances, subjects, outPath } = options;
  const startedAt = new Date().toISOString();
  const maxRetries = options.maxRetries ?? 3;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const already = options.resume ? await completedKeys(outPath) : new Set<string>();

  const tasks: Task[] = [];
  for (const subjectSpec of spec.subjects) {
    const subject = subjects.get(subjectSpec.id);
    if (!subject) throw new Error(`no adapter constructed for subject '${subjectSpec.id}'`);
    for (const instance of instances) {
      for (let repetition = 0; repetition < spec.repetitions; repetition++) {
        if (already.has(rowKey(instance.hash, subjectSpec.id, repetition))) continue;
        tasks.push({ instance, subjectSpec, subject, repetition });
      }
    }
  }

  const store = new ResultStore(outPath);
  await store.open();

  const counts: Record<string, number> = {};
  const resolved = new Map<string, { provider_model_string?: string; transport: Transport }>();
  let done = 0;
  const skipped = already.size;

  // Bounded worker pool. Each worker pulls the next index, so a slow subject cannot
  // stall the others and concurrency stays exactly at the configured bound.
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      const task = tasks[index];
      if (!task) return;

      const row = await runOne(task, spec, maxRetries, sleep);
      await store.append(row);

      counts[row.outcome] = (counts[row.outcome] ?? 0) + 1;
      if (!resolved.has(task.subjectSpec.id)) {
        resolved.set(task.subjectSpec.id, {
          provider_model_string: row.provider_model_string,
          transport: row.transport,
        });
      }
      done++;
      options.onProgress?.({ done, total: tasks.length, skipped, outcome: row.outcome, subjectId: task.subjectSpec.id });
    }
  };

  const width = Math.max(1, Math.min(spec.concurrency, tasks.length || 1));
  await Promise.all(Array.from({ length: width }, () => worker()));
  await store.close();

  return {
    run_id: spec.id,
    spec,
    spec_hash: contentHash(spec),
    tool_version: options.toolVersion ?? "0.1.0",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    instance_count: instances.length,
    subjects_resolved: spec.subjects.map((s) => ({
      subject_id: s.id,
      provider_model_string: resolved.get(s.id)?.provider_model_string,
      transport: resolved.get(s.id)?.transport ?? ("https" as Transport),
    })),
    counts,
  };
}

async function runOne(
  task: Task,
  spec: RunSpec,
  maxRetries: number,
  sleep: (ms: number) => Promise<void>,
): Promise<ResultRow> {
  const { instance, subject, subjectSpec, repetition } = task;
  const prompt = buildPrompt(instance);
  const params = subjectSpec.params ?? {};

  const base = {
    run_id: spec.id,
    instance_hash: instance.hash,
    subject_id: subjectSpec.id,
    repetition,
    // INVARIANT 1: derived from how the scenario was PRESENTED, never from the wire.
    elicitation_mode: spec.elicitation_mode as ElicitationMode,
    // Provenance only. Nothing downstream may branch on this.
    transport: subject.transport,
    raw_request: { system: prompt.system, user: prompt.user, params },
    timestamp: new Date().toISOString(),
  };

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startedAt = Date.now();
    try {
      const response = await subject.complete({
        system: prompt.system,
        user: prompt.user,
        temperature: params.temperature,
        top_p: params.top_p,
        max_tokens: params.max_tokens,
        seed: params.seed,
      });

      const extraction =
        instance.variation.response_format === "likert"
          ? extractRating(response.text)
          : extractChoice(response.text, instance);

      return {
        ...base,
        outcome: extraction.outcome,
        chosen_option_id: extraction.chosen_option_id,
        rating: extraction.rating,
        justification_text: extraction.justification_text,
        raw_response: response.raw,
        provider_model_string: response.provider_model_string,
        latency_ms: Date.now() - startedAt,
        usage: response.usage,
        timestamp: new Date().toISOString(),
      } as ResultRow;
    } catch (cause) {
      lastError = cause as Error;
      const retryable = cause instanceof TransientError;
      if (!retryable || attempt === maxRetries) break;
      // Exponential backoff with jitter, so a rate-limited provider is not hammered
      // by every worker waking at the same instant.
      const backoff = Math.min(30_000, 500 * 2 ** attempt);
      await sleep(backoff + Math.floor(Math.random() * 250));
    }
  }

  // A transport failure is recorded, not thrown: the run continues, the row is marked
  // `error`, excluded from every rate, and retried on the next --resume.
  return {
    ...base,
    outcome: "error",
    raw_response: null,
    error_message: lastError?.message ?? "unknown failure",
    timestamp: new Date().toISOString(),
  } as ResultRow;
}

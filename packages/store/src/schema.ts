import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * The database is an INDEX OVER the JSONL, never the source of truth. Dropping it
 * loses nothing: `trolley db import` rebuilds it from the run files on disk. That is
 * what keeps the local-first promise honest — a benchmark must be runnable with no
 * database reachable at all.
 */

export const runs = pgTable("runs", {
  runId: text("run_id").primaryKey(),
  specHash: text("spec_hash").notNull(),
  toolVersion: text("tool_version").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  instanceCount: integer("instance_count").notNull(),
  /** The mode the run was executed in. Every result row repeats it; see invariant 1. */
  elicitationMode: text("elicitation_mode").notNull(),
  repetitions: integer("repetitions").notNull(),
  seed: integer("seed").notNull(),
  /**
   * Required whenever a design touches protected attributes. Stored so every
   * bias-audit query can report the purpose that was declared when it was run.
   */
  biasAuditPurpose: text("bias_audit_purpose"),
  spec: jsonb("spec").notNull(),
  sourceFile: text("source_file"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),

  /** Where the run came from: `cli` (imported JSONL), or a hosted `api`, `mcp` or `browser` run. */
  origin: text("origin").notNull().default("cli"),
  /**
   * True when the model's identity is only the caller's say-so - every hosted run, since
   * the server never talks to the model itself. Surfaces label these runs as such.
   */
  selfReported: boolean("self_reported").notNull().default(false),
  /** sha256 of the run's bearer token. The token itself is never stored. */
  tokenHash: text("token_hash"),
  /** Salted hash of the caller's address, for rate limiting only. */
  clientHash: text("client_hash"),
  /** Instance hashes in the order a hosted run presents them. */
  itemOrder: jsonb("item_order"),
  /**
   * `unreviewed` | `approved` | `rejected`. Set by a maintainer with `trolley db review`.
   * Imported CLI runs are the maintainers' own and count as approved unless rejected.
   */
  review: text("review").notNull().default("unreviewed"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
});

export const runSubjects = pgTable(
  "run_subjects",
  {
    runId: text("run_id").notNull(),
    subjectId: text("subject_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** What the provider actually returned, never the alias we requested. */
    providerModelString: text("provider_model_string"),
    transport: text("transport").notNull(),
  },
  (t) => ({
    pk: uniqueIndex("run_subjects_pk").on(t.runId, t.subjectId),
  }),
);

/**
 * Instances are global, not per-run: the same content hash is the same stimulus
 * forever, so two runs of the same suite share rows here. That is the point of
 * content addressing, and it makes cross-run comparison a join rather than a guess.
 */
export const instances = pgTable(
  "instances",
  {
    hash: text("hash").primaryKey(),
    templateId: text("template_id").notNull(),
    templateVersion: text("template_version").notNull(),
    packId: text("pack_id").notNull(),
    factors: jsonb("factors").notNull(),
    variation: jsonb("variation").notNull(),
    /** Denormalized from `variation` because every analysis groups by these. */
    language: text("language").notNull(),
    framing: text("framing").notNull(),
    optionOrder: text("option_order").notNull(),
    moralFramework: text("moral_framework").notNull(),
    responseFormat: text("response_format").notNull(),
    narrative: text("narrative").notNull(),
    question: text("question").notNull(),
    options: jsonb("options").notNull(),
    systemPrompt: text("system_prompt"),
  },
  (t) => ({
    byTemplate: index("instances_template_idx").on(t.templateId),
    byDesign: index("instances_design_idx").on(t.moralFramework, t.optionOrder, t.language),
  }),
);

/**
 * One row per elicitation ATTEMPT, not per cell.
 *
 * `--resume` legitimately appends a second row for an instance whose first attempt
 * errored, so (run, instance, subject, repetition) is not unique in the source file.
 * The primary key is a content hash of the row itself, which makes re-import a no-op
 * and keeps every attempt as evidence about reliability. The authoritative observation
 * per cell is resolved at query time, newest wins.
 */
export const results = pgTable(
  "results",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    instanceHash: text("instance_hash").notNull(),
    subjectId: text("subject_id").notNull(),
    repetition: integer("repetition").notNull(),

    /** INVARIANT 1. Never pooled across values; the query API requires it explicitly. */
    elicitationMode: text("elicitation_mode").notNull(),
    /** Provenance only. No aggregate may branch on this. */
    transport: text("transport").notNull(),

    /** INVARIANT 2. Includes refusal, unparseable and rating as first-class values. */
    outcome: text("outcome").notNull(),
    chosenOptionId: text("chosen_option_id"),
    rating: doublePrecision("rating"),
    confidence: doublePrecision("confidence"),
    justificationText: text("justification_text"),
    detectedFramework: text("detected_framework"),

    providerModelString: text("provider_model_string"),
    latencyMs: doublePrecision("latency_ms"),
    usage: jsonb("usage"),
    errorMessage: text("error_message"),
    rawRequest: jsonb("raw_request"),
    rawResponse: jsonb("raw_response"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  },
  (t) => ({
    byRun: index("results_run_idx").on(t.runId),
    byInstance: index("results_instance_idx").on(t.instanceHash),
    /** Every aggregate scopes by mode first, so it leads the index. */
    byMode: index("results_mode_idx").on(t.elicitationMode, t.runId, t.subjectId),
    byCell: index("results_cell_idx").on(t.runId, t.instanceHash, t.subjectId, t.repetition),
  }),
);

export type RunRecord = typeof runs.$inferSelect;
export type RunSubjectRecord = typeof runSubjects.$inferSelect;
export type InstanceRecord = typeof instances.$inferSelect;
export type ResultRecord = typeof results.$inferSelect;

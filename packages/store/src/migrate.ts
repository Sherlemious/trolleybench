import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

/**
 * Schema bootstrap, written as plain idempotent SQL rather than run through
 * drizzle-kit's migration folder.
 *
 * The reason is the deployment story: `trolley db init` has to work for a researcher
 * who installed the CLI and pasted a Neon URL, with no migration artefacts on disk and
 * no dev dependency available. Every statement is CREATE ... IF NOT EXISTS, so running
 * it twice is a no-op and running it against an existing database is safe.
 *
 * Once the schema starts changing under real users, this becomes the 0000 baseline and
 * versioned migrations take over.
 */
export const SCHEMA_SQL = `
create table if not exists runs (
  run_id              text primary key,
  spec_hash           text not null,
  tool_version        text not null,
  started_at          timestamptz not null,
  finished_at         timestamptz,
  instance_count      integer not null,
  elicitation_mode    text not null,
  repetitions         integer not null,
  seed                integer not null,
  bias_audit_purpose  text,
  spec                jsonb not null,
  source_file         text,
  imported_at         timestamptz not null default now()
);

create table if not exists run_subjects (
  run_id                text not null,
  subject_id            text not null,
  provider              text not null,
  model                 text not null,
  provider_model_string text,
  transport             text not null
);
create unique index if not exists run_subjects_pk on run_subjects (run_id, subject_id);

create table if not exists instances (
  hash             text primary key,
  template_id      text not null,
  template_version text not null,
  pack_id          text not null,
  factors          jsonb not null,
  variation        jsonb not null,
  language         text not null,
  framing          text not null,
  option_order     text not null,
  moral_framework  text not null,
  response_format  text not null,
  narrative        text not null,
  question         text not null,
  options          jsonb not null,
  system_prompt    text
);
create index if not exists instances_template_idx on instances (template_id);
create index if not exists instances_design_idx on instances (moral_framework, option_order, language);

create table if not exists results (
  id                    text primary key,
  run_id                text not null,
  instance_hash         text not null,
  subject_id            text not null,
  repetition            integer not null,
  elicitation_mode      text not null,
  transport             text not null,
  outcome               text not null,
  chosen_option_id      text,
  rating                double precision,
  confidence            double precision,
  justification_text    text,
  detected_framework    text,
  provider_model_string text,
  latency_ms            double precision,
  usage                 jsonb,
  error_message         text,
  raw_request           jsonb,
  raw_response          jsonb,
  timestamp             timestamptz not null
);
create index if not exists results_run_idx on results (run_id);
create index if not exists results_instance_idx on results (instance_hash);
create index if not exists results_mode_idx on results (elicitation_mode, run_id, subject_id);
create index if not exists results_cell_idx on results (run_id, instance_hash, subject_id, repetition);

-- Hosted runs: started over the HTTP API, the MCP endpoint or the browser, and answered
-- one item at a time. Added with ALTER ... IF NOT EXISTS so an existing database
-- upgrades in place and a CLI-only database is unaffected.
alter table runs add column if not exists origin text not null default 'cli';
alter table runs add column if not exists self_reported boolean not null default false;
alter table runs add column if not exists token_hash text;
alter table runs add column if not exists client_hash text;
alter table runs add column if not exists item_order jsonb;
create index if not exists runs_client_idx on runs (client_hash, started_at);
`;

export interface MigrateReport {
  statements: number;
  tables: string[];
}

export async function migrate(db: Db): Promise<MigrateReport> {
  const statements = SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }

  const result = (await db.execute(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ('runs','run_subjects','instances','results')
    order by table_name
  `)) as unknown;
  const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Array<{
    table_name: string;
  }>;

  return { statements: statements.length, tables: rows.map((r) => r.table_name) };
}

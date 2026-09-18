import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * Typed against the driver-agnostic base so the same query layer runs on postgres.js
 * (Neon, production) and on PGlite (tests, real Postgres in-process). Tests therefore
 * exercise the actual SQL - DISTINCT ON, FILTER clauses, jsonb - rather than a mock
 * that would happily agree with a broken query.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface ConnectOptions {
  /** Postgres connection string. Defaults to DATABASE_URL. */
  url?: string;
  /** Statement timeout in seconds. Keeps a runaway analytical query from hanging a CLI. */
  timeoutSeconds?: number;
  max?: number;
}

export class MissingDatabaseUrl extends Error {
  constructor() {
    super(
      "No database configured. Set DATABASE_URL to your Neon connection string, or add it to .env\n" +
        "  DATABASE_URL=postgresql://user:pass@host.neon.tech/db?sslmode=require\n\n" +
        "The database is optional: runs still write JSONL and every other command works without it.",
    );
    this.name = "MissingDatabaseUrl";
  }
}

export interface Connection {
  db: Db;
  close: () => Promise<void>;
}

export function connect(options: ConnectOptions = {}): Connection {
  const url = options.url ?? process.env["DATABASE_URL"];
  if (!url) throw new MissingDatabaseUrl();

  // Neon terminates idle connections and requires TLS. `prepare: false` keeps this
  // working through a connection pooler, where prepared statements are not safe.
  const sql = postgres(url, {
    max: options.max ?? 5,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
  });

  const db = drizzlePg(sql, { schema });
  return { db, close: async () => sql.end({ timeout: 5 }) };
}

export function hasDatabaseUrl(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env["DATABASE_URL"]);
}

export { schema };

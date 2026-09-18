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

/**
 * Strip a matched pair of surrounding quotes.
 *
 * A quoted value is what you get from copying a line out of a `.env` file into a
 * hosting dashboard, and no valid connection string begins with a quote, so this is
 * unambiguous rather than lenient. It is worth handling because the failure it prevents
 * is disproportionate: postgres.js throws `ERR_INVALID_URL` with the whole string as
 * `input`, and an unhandled throw puts the password in the platform's logs.
 */
function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return quoted && trimmed.length >= 2 ? trimmed.slice(1, -1) : trimmed;
}

export class InvalidDatabaseUrl extends Error {
  /** The driver's error code, e.g. ERR_INVALID_URL. Safe to log; the URL is not. */
  readonly code: string;

  constructor(cause: unknown) {
    super(
      "DATABASE_URL is not a valid Postgres connection string. Expected " +
        "postgresql://user:password@host/database?sslmode=require\n" +
        "The value itself is not shown here, and must not be logged: it contains a password.",
    );
    this.name = "InvalidDatabaseUrl";
    // The driver reports a bad URL with the whole string on `error.input`, so the
    // original error is NOT attached as `cause`: anything that serialises this - a
    // logger, JSON.stringify, a platform's error reporter - would republish the
    // password. Only the code survives, which is all that helps anyone debug.
    this.code =
      typeof (cause as { code?: unknown } | null)?.code === "string"
        ? (cause as { code: string }).code
        : "ERR_INVALID_DATABASE_URL";
  }
}

export function connect(options: ConnectOptions = {}): Connection {
  const raw = options.url ?? process.env["DATABASE_URL"];
  if (!raw) throw new MissingDatabaseUrl();
  const url = unquote(raw);

  // Neon terminates idle connections and requires TLS. `prepare: false` keeps this
  // working through a connection pooler, where prepared statements are not safe.
  let sql: ReturnType<typeof postgres>;
  try {
    sql = postgres(url, {
      max: options.max ?? 5,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
      ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
    });
  } catch (cause) {
    throw new InvalidDatabaseUrl(cause);
  }

  const db = drizzlePg(sql, { schema });
  return { db, close: async () => sql.end({ timeout: 5 }) };
}

export function hasDatabaseUrl(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env["DATABASE_URL"]);
}

export { schema };

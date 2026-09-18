import type { Connection } from "@trolleybench/store";

/**
 * Lazy, cached database handle for the deployed app.
 *
 * Three things this has to get right, none of which the CLI has to care about:
 *
 * 1. **The database is optional.** The workbench itself is a pure function of committed
 *    content and prerenders statically, so a deployment with no `DATABASE_URL` must
 *    serve the whole site and simply report that results are unavailable. Returning
 *    `null` rather than throwing is what keeps that true.
 * 2. **The import is dynamic.** `@trolleybench/store` pulls in postgres.js and drizzle;
 *    importing it at module scope would drag both into any bundle that touches this
 *    file, including the static page's build-time path.
 * 3. **One pool per lambda instance.** Each serverless instance gets its own module
 *    scope, so the handle is cached here and the pool is kept small - the connection
 *    string points at Neon's pooler, and the pooler is what does the real multiplexing.
 */
let cached: Connection | null | undefined;

export async function getDb(): Promise<Connection | null> {
  if (cached !== undefined) return cached;

  if (!process.env["DATABASE_URL"]) {
    cached = null;
    return cached;
  }

  const { connect } = await import("@trolleybench/store");
  // max: 1 because the fan-out lives in Neon's pooler, not in this process. A pool of
  // five per lambda instance multiplies by however many instances Vercel decides to run.
  cached = connect({ max: 1 });
  return cached;
}

export function databaseConfigured(): boolean {
  return Boolean(process.env["DATABASE_URL"]);
}

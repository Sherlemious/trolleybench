import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { NextResponse } from "next/server";
import type { Db } from "@trolleybench/store";
import type { Catalog } from "@trolleybench/session";
import { getDb } from "./db";

const ROOT = resolve(process.cwd(), "..", "..");

/**
 * Shared plumbing for the hosted-run endpoints: the HTTP API and the MCP server.
 *
 * Both are thin. Everything that decides what gets written - scoring, the one-answer
 * rule, token checks, rate limits - lives in @trolleybench/session, where it is tested
 * against real Postgres. This file only turns requests into calls and errors into
 * responses.
 */

let catalogPromise: Promise<Catalog> | null = null;

/** Packs and every suite definition, loaded once per server instance. */
export function catalog(): Promise<Catalog> {
  catalogPromise ??= (async () => {
    const { loadPackDir, loadSuiteFile } = await import("@trolleybench/scenarios");
    const packs = await loadPackDir(resolve(ROOT, "content", "packs"));
    const dir = resolve(ROOT, "content", "suites");
    const files = (await readdir(dir)).filter((f) => /\.ya?ml$/.test(f) && !f.includes(".lock"));
    const suites = await Promise.all(files.map((f) => loadSuiteFile(resolve(dir, f))));
    return { packs, suites };
  })();
  return catalogPromise;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function requireDb(): Promise<Db> {
  const connection = await getDb();
  if (!connection) {
    throw new ApiError(
      503,
      "no_database",
      "This deployment has no database, so hosted runs are unavailable. Run locally with the CLI instead.",
    );
  }
  return connection.db;
}

/**
 * Identify a caller for rate limiting only. The address is hashed before it is stored,
 * and never used for anything else.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new ApiError(401, "unauthorized", "send the run's token as `Authorization: Bearer <token>`");
  return match[1]!.trim();
}

/**
 * Open to any origin. Every write needs a per-run bearer token and nothing uses
 * cookies, so a permissive CORS policy exposes nothing a direct request would not.
 */
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: CORS });
}

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Run a handler and map failures to responses. Known errors carry their own status and
 * message. Anything else becomes a bare 500: a database error can carry the connection
 * string in fields a message scrub never sees, and this site has leaked one into its
 * logs that way before - so only the error's NAME is logged, and nothing is echoed.
 */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (cause) {
    if (cause instanceof ApiError) return json({ error: cause.code, message: cause.message }, cause.status);
    if (cause && typeof cause === "object" && (cause as { name?: string }).name === "SessionError") {
      const e = cause as { status: number; code: string; message: string };
      return json({ error: e.code, message: e.message }, e.status);
    }
    console.error(`hosted-run handler failed: ${cause instanceof Error ? cause.name : "Error"}`);
    return json({ error: "internal", message: "The request failed. Nothing about the failure is echoed here." }, 500);
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 64_000) throw new ApiError(413, "body_too_large", "request body is capped at 64 KB");
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "bad_json", "the request body must be a JSON object");
  }
}

/** The site's own origin, for links in responses. */
export function siteOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

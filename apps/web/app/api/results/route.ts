import { NextResponse } from "next/server";
import type { ElicitationMode } from "@trolleybench/spec";
import type { GroupableField } from "@trolleybench/store";
import { getDb } from "../../../lib/db";

/**
 * Read-only view of stored results.
 *
 * `force-dynamic` because the rest of the site prerenders statically and must keep
 * doing so: the workbench is a pure function of committed content, and a build that
 * needed a database would fail on any deployment without one. Everything that touches
 * Postgres lives behind this route instead.
 *
 * `nodejs` because postgres.js speaks the wire protocol over a TCP socket, which the
 * edge runtime does not provide.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GROUPABLE: readonly GroupableField[] = [
  "moral_framework",
  "option_order",
  "language",
  "framing",
  "template_id",
  "pack_id",
];

/**
 * Schema invariant 1, at the HTTP boundary. A model answering a prompt and a model
 * calling `pull_lever()` are not commensurable, so there is no "all modes" response
 * shape here either: without `?mode=`, the caller gets the list of modes present and
 * has to choose one. Pooling has to be a deliberate act, and this API does not offer it.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const connection = await getDb();
  if (!connection) {
    return NextResponse.json(
      {
        database: "not_configured",
        detail:
          "No DATABASE_URL is set on this deployment. The scenario workbench does not " +
          "need one; stored run results do.",
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  const { listRuns, modesPresent, outcomeBreakdown, ratesBy } = await import(
    "@trolleybench/store"
  );

  try {
    if (!mode) {
      const [modes, runs] = await Promise.all([
        modesPresent(connection.db),
        listRuns(connection.db, 50),
      ]);
      return NextResponse.json({
        database: "connected",
        modes,
        runs,
        note:
          "Results are never pooled across elicitation modes. Re-request with " +
          "?mode=<one of the modes above> for outcome rates.",
      });
    }

    const filter = {
      mode: mode as ElicitationMode,
      ...(url.searchParams.get("run") ? { runId: url.searchParams.get("run")! } : {}),
    };

    const byParam = url.searchParams.get("by");
    const by = GROUPABLE.find((f) => f === byParam);
    if (byParam && !by) {
      return NextResponse.json(
        { error: `not a groupable design field: ${byParam}`, groupable: GROUPABLE },
        { status: 400 },
      );
    }

    const breakdown = await outcomeBreakdown(connection.db, filter);
    const groups = by ? await ratesBy(connection.db, by, filter) : undefined;

    return NextResponse.json({
      database: "connected",
      mode,
      breakdown,
      ...(groups ? { by, groups } : {}),
    });
  } catch (cause) {
    // Never leak a connection string in an error body.
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json(
      { database: "error", detail: message.replace(/postgres(ql)?:\/\/\S+/gi, "[redacted]") },
      { status: 500 },
    );
  }
}

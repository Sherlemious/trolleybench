import { handle, json, preflight, requireDb, siteOrigin } from "../../../../../lib/hosted";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/runs/:id - public progress and headline numbers for a hosted run. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const { runStatus } = await import("@trolleybench/session");
    const status = await runStatus(await requireDb(), id);
    return json({ ...status, results: `${siteOrigin(request)}/results/${id}` });
  });
}

export const OPTIONS = preflight;

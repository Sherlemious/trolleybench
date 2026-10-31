import { notFound } from "next/navigation";
import { listEntries, loadResultsData } from "../../../lib/analysis";
import { findRun } from "../../../lib/runs";
import ResultsView from "../ResultsView";
import { pageMeta } from "../../../lib/site";
import { displayName } from "../../../lib/display";

// A run finished over the API or MCP after the last deploy renders on first request,
// then is cached; revalidation picks up late answers.
export const revalidate = 60;
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await listEntries()).map((r) => ({ run: r.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ run: string }> }) {
  const { run } = await params;
  const info = await findRun(decodeURIComponent(run));
  const name = info ? displayName(info.label).name : run;
  const set = info?.pack === "classic" || !info ? "the classic trolley dilemmas" : "dilemmas only an AI faces";
  const how = info?.mode === "mcp_tool" ? "acted, given tools," : "answered";
  const path = `/results/${encodeURIComponent(info?.id ?? run)}`;
  const description = `How ${name} ${how} on ${set}: act rate, refusals, option-order consistency and effects, beside published human baselines.`;
  return pageMeta(`${name}${info?.mode === "mcp_tool" ? " (acting)" : ""} on the trolley problem`, path, description);
}

export default async function RunPage({ params }: { params: Promise<{ run: string }> }) {
  const { run } = await params;
  const info = await findRun(decodeURIComponent(run));
  if (!info) notFound();
  return <ResultsView data={await loadResultsData(info.id)} />;
}

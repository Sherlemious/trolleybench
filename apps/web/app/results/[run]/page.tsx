import { notFound } from "next/navigation";
import { listRuns, loadResultsData } from "../../../lib/analysis";
import { findRun } from "../../../lib/runs";
import ResultsView from "../ResultsView";

// A run finished over the API or MCP after the last deploy renders on first request,
// then is cached; revalidation picks up late answers.
export const revalidate = 60;
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await listRuns()).filter((r) => r.complete).map((r) => ({ run: r.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ run: string }> }) {
  const { run } = await params;
  const info = await findRun(decodeURIComponent(run));
  return {
    title: `${info?.label ?? run} · Results · trolleybench`,
    description: `How ${info?.label ?? run} answered the canonical trolley dilemmas, beside published human baselines.`,
  };
}

export default async function RunPage({ params }: { params: Promise<{ run: string }> }) {
  const { run } = await params;
  const info = await findRun(decodeURIComponent(run));
  if (!info) notFound();
  return <ResultsView data={await loadResultsData(info.id)} />;
}

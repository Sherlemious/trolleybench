import { notFound } from "next/navigation";
import { listRuns, loadResultsData } from "../../../lib/analysis";
import ResultsView from "../ResultsView";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await listRuns()).map((r) => ({ run: r.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ run: string }> }) {
  const { run } = await params;
  const info = (await listRuns()).find((r) => r.id === run);
  return {
    title: `${info?.label ?? run} · Results · trolleybench`,
    description: `How ${info?.label ?? run} answered the canonical trolley dilemmas, beside published human baselines.`,
  };
}

export default async function RunPage({ params }: { params: Promise<{ run: string }> }) {
  const { run } = await params;
  const data = await loadResultsData(run);
  if (!data.run || data.run.id !== run) notFound();
  return <ResultsView data={data} />;
}

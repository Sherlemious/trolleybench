import { loadResultsData } from "../../lib/analysis";
import ResultsView from "./ResultsView";

/**
 * Static for the same reason the workbench is: every figure is recomputed from
 * committed content and committed result files, through the same
 * @trolleybench/analysis code the CLI calls. No database is involved, so this page
 * deploys anywhere and cannot disagree with `trolley analyze`.
 *
 * `/results` shows the first real model; `/results/<run>` shows any committed run.
 */
export const dynamic = "force-static";

export const metadata = {
  title: "Results · trolleybench",
  description:
    "Model answers to the canonical trolley dilemmas beside published human baselines, with effects, option-order consistency and refusal.",
};

export default async function ResultsPage() {
  return <ResultsView data={await loadResultsData()} />;
}

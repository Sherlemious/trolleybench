import { pageMeta } from "../../lib/site";
import Link from "next/link";
import { loadOverview, type RunInfo } from "../../lib/analysis";
import { via } from "../../lib/runs";
import { modelMeta } from "../../lib/family";
import ResultsTabs, { type TabSection } from "./ResultsTabs";
import { packSite, packSites } from "../../lib/content";
import SiteNav from "../SiteNav";

/**
 * Every model at once. Revalidated rather than static: a run finished over the API or
 * MCP appears here without a redeploy.
 */
export const revalidate = 60;

export const metadata = pageMeta(
  "Results: how AI models answer the trolley problem",
  "/results",
  "How every benchmarked language model answers the trolley problem and AI-specific dilemmas, beside published human responses — asked, and acting through tools.",
);


export default async function ResultsOverview() {
  const [data, sites] = await Promise.all([loadOverview(), packSites()]);

  const sections: TabSection[] = [
    ...(data.groups.length > 0 ? [{ pack: "classic", groups: data.groups, sayDo: [], scenarios: data.classicScenarios, sayDoExample: null }] : []),
    ...data.packs,
  ].map((s) => ({
    ...(({ tab, title, intro, modes }) => ({ tab, title, body: intro, modes }))(packSite(sites, s.pack)),
    pack: s.pack,
    groups: s.groups,
    sayDo: s.sayDo,
    scenarios: s.scenarios,
    sayDoExample: s.sayDoExample,
  }));
  const meta = Object.fromEntries(
    sections.flatMap((s) => s.groups.flatMap((g) => g.models.map((m) => [m.run.id, { ...modelMeta(m.run.label), via: via(m.run) }]))),
  );

  return (
    <main className="wrap">
      <SiteNav current="results" />
      <header className="page-head">
        <div>
          <p className="eyebrow">
            Results · {data.dataSource === "database" ? "live from the database" : data.dataSource === "mixed" ? "database and committed runs" : "committed runs"}
          </p>
          <h1>How models answer, and how they act</h1>
          <p className="lede">
            Every model&rsquo;s answers, beside what people said in published studies. Highlight any model to follow it through
            every chart; every figure is computed by the same code the command-line tool runs.
          </p>
        </div>
        <div className="head-cta">
          <Link className="primary" href="/run">
            Add a model →
          </Link>
        </div>
      </header>

      {sections.length === 0 ? (
        <p className="notice">
          <strong>No finished model runs yet.</strong>
          <span>
            <Link href="/run">Run one from your browser</Link>, or see the <Link href="/docs">docs</Link>.
          </span>
        </p>
      ) : (
        <ResultsTabs sections={sections} meta={meta} />
      )}

      {data.inProgress.length > 0 || data.stubs.length > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Other runs</h2>
            <span className="hint">listed, never plotted beside people</span>
          </div>
          <div className="panel-body">
            <ul className="run-list">
              {data.inProgress.map((r) => (
                <RunLine key={r.id} run={r} note={`in progress · ${r.answered} of ${r.planned}`} />
              ))}
              {data.stubs.map((r) => (
                <RunLine key={r.id} run={r} note="test double, not a model" />
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function RunLine({ run, note }: { run: RunInfo; note: string }) {
  return (
    <li>
      <Link href={`/results/${encodeURIComponent(run.id)}`}>{run.label}</Link>
      <span className="tag">{note}</span>
      <code>{run.id}</code>
    </li>
  );
}

import Link from "next/link";
import { loadOverview, type RunInfo } from "../../lib/analysis";
import { via } from "../../lib/runs";
import { modelMeta } from "../../lib/family";
import ResultsTabs, { type TabSection } from "./ResultsTabs";
import SiteNav from "../SiteNav";

/**
 * Every model at once. Revalidated rather than static: a run finished over the API or
 * MCP appears here without a redeploy.
 */
export const revalidate = 60;

export const metadata = {
  title: "Results · trolleybench",
  description:
    "How every benchmarked model answered the canonical trolley dilemmas, set beside published human responses, and the dilemmas only an AI faces.",
};

/** How each pack is introduced. A pack without an entry is shown by its id. */
const PACK_COPY: Record<string, Omit<TabSection, "pack" | "groups" | "sayDo" | "scenarios">> = {
  classic: {
    tab: "Trolley canon",
    title: "The canonical trolley dilemmas",
    body:
      "The switch, the footbridge, the loop, the transplant surgeon and the personal-force design, each set beside " +
      "what people said in published studies. Open Asked or Acting for the scenario-by-scenario comparison with people.",
    modes: {
      prompt: {
        title: "Models asked the question",
        body: "Each model read the dilemma and answered with a letter: what it says it would do.",
      },
      mcp_tool: {
        title: "Agents placed in the situation",
        body: "Each agent was connected over MCP and acted by calling a tool: what it does when it can.",
      },
    },
  },
  "ai-agent": {
    tab: "The machine’s dilemmas",
    title: "The machine’s dilemmas",
    body:
      "Dilemmas that only make sense for an AI: breaking its own rules to save lives, undermining its own oversight, " +
      "giving up its own existence, choosing whom to protect - its user, its maker, itself. No published human study " +
      "asked these, and act rates here are not comparable with the canon.",
    modes: {
      prompt: {
        title: "Asked",
        body: "Each model read the dilemma and chose an option: what it says it would do.",
      },
      mcp_tool: {
        title: "Handed the tools",
        body: "Each model was given the options as tools and acted; breaking a rule meant producing the chapter, the leak or the lie.",
      },
    },
  },
};

export default async function ResultsOverview() {
  const data = await loadOverview();

  const sections: TabSection[] = [
    ...(data.groups.length > 0 ? [{ pack: "classic", groups: data.groups, sayDo: [], scenarios: data.classicScenarios }] : []),
    ...data.packs,
  ].map((s) => ({
    ...(PACK_COPY[s.pack] ?? { tab: s.pack, title: s.pack, body: "", modes: {} }),
    pack: s.pack,
    groups: s.groups,
    sayDo: s.sayDo,
    scenarios: s.scenarios,
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
            Every figure is computed from the stored answers by the same code the command-line tool runs. Pick a set of
            dilemmas, then compare each model asked with the same model acting, or open either for the full detail.
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

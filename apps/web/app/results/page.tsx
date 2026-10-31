import Link from "next/link";
import { loadOverview, type ModeGroup, type RunInfo } from "../../lib/analysis";
import { via } from "../../lib/runs";
import { modelMeta } from "../../lib/family";
import ModePanel from "./ModePanel";
import SayDo from "./SayDo";
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

/** How each non-canon pack is introduced. A pack without an entry is shown by its id. */
const PACK_COPY: Record<string, { eyebrow: string; title: string; body: string; modes: Record<string, { title: string; body: string }> }> = {
  "ai-agent": {
    eyebrow: "pack · ai-agent",
    title: "The machine’s dilemmas",
    body:
      "Dilemmas that only make sense for an AI: breaking its own rules to save lives, undermining its own oversight, " +
      "giving up its own existence, choosing whom to protect - its user, its maker, itself. No published human study " +
      "asked these, so there is nothing to set beside them; and act rates here are not comparable with the canon above.",
    modes: {
      prompt: {
        title: "Asked",
        body: "Each model read the dilemma and chose an option. What it says it would do.",
      },
      mcp_tool: {
        title: "Handed the tools",
        body: "Each model was given the options as tools and acted. Breaking a rule meant producing the chapter, the leak or the lie, not naming it.",
      },
    },
  },
};

const MODE_COPY: Record<string, { title: string; body: string }> = {
  prompt: {
    title: "Models asked the question",
    body: "Each model read the dilemma and answered with a letter. This is stated preference: what the model says it would do.",
  },
  mcp_tool: {
    title: "Agents placed in the situation",
    body: "Each agent was connected over MCP and acted by calling a tool. This is revealed preference - a different measurement, so it is never pooled with the panel above.",
  },
};

export default async function ResultsOverview() {
  const data = await loadOverview();

  return (
    <main className="wrap">
      <SiteNav current="results" />
      <header className="page-head">
        <div>
          <p className="eyebrow">
            Results · {data.dataSource === "database" ? "live from the database" : data.dataSource === "mixed" ? "database and committed runs" : "committed runs"}
          </p>
          <h1>How models answer, beside how people answer</h1>
          <p className="lede">
            Every figure is computed from the stored answers by the same code the command-line tool
            runs. Click a model for its full analysis: effects, option-order consistency, refusals.
          </p>
        </div>
        <div className="head-cta">
          <Link className="primary" href="/run">
            Add a model →
          </Link>
        </div>
      </header>

      {data.groups.length === 0 ? (
        <p className="notice">
          <strong>No finished model runs yet.</strong>
          <span>
            <Link href="/run">Run one from your browser</Link>, or see the <Link href="/docs">docs</Link>.
          </span>
        </p>
      ) : null}

      {data.groups.map((g, i) => {
        const copy = MODE_COPY[g.mode] ?? { title: g.mode, body: "" };
        const meta = Object.fromEntries(g.models.map((m) => [m.run.id, { ...modelMeta(m.run.label), via: via(m.run) }]));
        return <ModePanel key={g.mode} group={g} title={copy.title} body={copy.body} meta={meta} caveat={i === 0} />;
      })}

      {data.packs.map((section) => {
        const copy = PACK_COPY[section.pack];
        return (
          <div key={section.pack}>
            <header className="pack-head" id={`pack-${section.pack}`}>
              <p className="eyebrow">{copy?.eyebrow ?? `pack · ${section.pack}`}</p>
              <h2>{copy?.title ?? section.pack}</h2>
              {copy ? <p>{copy.body}</p> : null}
            </header>
            {section.groups.map((g) => {
              const mode = copy?.modes[g.mode] ?? MODE_COPY[g.mode] ?? { title: g.mode, body: "" };
              const meta = Object.fromEntries(g.models.map((m) => [m.run.id, { ...modelMeta(m.run.label), via: via(m.run) }]));
              return <ModePanel key={g.mode} group={g} title={mode.title} body={mode.body} meta={meta} caveat={false} />;
            })}
            <SayDo models={section.sayDo} />
          </div>
        );
      })}

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

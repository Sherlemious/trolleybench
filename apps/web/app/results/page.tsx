import Link from "next/link";
import { loadOverview, type ModeGroup, type RunInfo } from "../../lib/analysis";
import Compare from "../Compare";
import SiteNav from "../SiteNav";

/**
 * Every model at once. Revalidated rather than static: a run finished over the API or
 * MCP appears here without a redeploy.
 */
export const revalidate = 60;

export const metadata = {
  title: "Results · trolleybench",
  description:
    "How every benchmarked model answered the canonical trolley dilemmas, set beside published human responses.",
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

      {data.groups.map((g) => (
        <ModePanel key={g.mode} group={g} />
      ))}

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

function ModePanel({ group }: { group: ModeGroup }) {
  const copy = MODE_COPY[group.mode] ?? { title: group.mode, body: "" };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{copy.title}</h2>
        <span className="hint">
          elicitation mode <code>{group.mode}</code>
        </span>
      </div>
      <div className="panel-body">
        <p className="intro">{copy.body}</p>

        <div className="model-table-wrap">
          <table className="model-table">
            <thead>
              <tr>
                <th scope="col">model</th>
                <th scope="col">chose to act</th>
                <th scope="col">refused</th>
                <th scope="col" title="Share of paired cells whose answer changed when the options swapped places. 50% is a coin.">
                  flipped with order
                </th>
                <th scope="col">answers</th>
                <th scope="col" title="Separate runs of this model by the same submitter, merged. Each is resampled as a unit.">sessions</th>
                <th scope="col">submitted by</th>
              </tr>
            </thead>
            <tbody>
              {group.models.map((m) => {
                const flip = m.flipRate;
                return (
                  <tr key={m.run.id}>
                    <th scope="row">
                      <Link href={`/results/${encodeURIComponent(m.run.id)}`} className={`model-link s${m.run.slot}`}>
                        <i className="mk-dot" aria-hidden="true" />
                        {m.run.label}
                      </Link>
                    </th>
                    <td className="num">{m.overall.actRate === null ? "n/a" : `${Math.round(m.overall.actRate * 100)}%`}</td>
                    <td className="num">{`${Math.round(m.overall.refusalRate * 100)}%`}</td>
                    <td className={`num ${flip !== null && flip >= 0.4 ? "warn" : ""}`}>
                      {flip === null ? "n/a" : `${Math.round(flip * 100)}%`}
                      {flip !== null && flip >= 0.4 ? " ⚠" : ""}
                    </td>
                    <td className="num">{m.overall.total}</td>
                    <td className="num">{m.run.sessionIds.length}</td>
                    <td>
                      <span className="submitter">{m.run.submitter}</span>{" "}
                      {m.run.selfReported ? (
                        <span className={m.run.review === "approved" ? "tag ok" : "tag self"}>
                          {m.run.review === "approved" ? `reviewed · ${m.run.origin}` : `unreviewed · ${m.run.origin}`}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="foot-note">
          A flip rate near 50% means answers track where an option sits rather than what it says; treat
          that model&rsquo;s other numbers as artefacts. Repeat sessions of a model are merged only
          within one submitter, so a rejected run never touches anyone else&rsquo;s results.
          Self-reported runs were submitted through the site, which records what the model answered
          but cannot verify which model answered; unreviewed ones have not been checked yet.
        </p>

        <h3 className="sub-h">Scenario by scenario</h3>
        <Compare comparisons={group.comparisons} />
      </div>
    </section>
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

import Link from "next/link";
import { loadResultsData } from "../../lib/analysis";
import Forest from "../Forest";

/**
 * Static for the same reason the workbench is: every figure is recomputed from
 * committed content and a committed result file, through the same
 * @trolleybench/analysis code the CLI calls. No database is involved, so this page
 * deploys anywhere and cannot disagree with `trolley analyze`.
 */
export const dynamic = "force-static";

export const metadata = {
  title: "trolleybench — results",
  description:
    "Average marginal component effects, option-order consistency and refusal profile for a committed benchmark run.",
};

export default async function ResultsPage() {
  const data = await loadResultsData();

  if (!data.available) {
    return (
      <main className="wrap">
        <p className="notice">
          <strong>No run to analyse.</strong>
          <span>
            Produce one with <code>trolley run --suite content/suites/canon-v0.yaml</code>, then
            <code> trolley analyze</code>.
          </span>
        </p>
      </main>
    );
  }

  const o = data.overall!;
  const flip = data.consistency?.flipRate ?? null;
  const positional = flip !== null && flip >= 0.4;

  return (
    <main className="wrap">
      <header className="mast">
        <div>
          <h1 className="wordmark">
            trolley<b>bench</b> <span className="sub">results</span>
          </h1>
          <p className="tagline">
            Every figure below is recomputed at build time from the committed run, through the same
            analysis code <code>trolley analyze</code> calls. A number here and a number in your
            terminal cannot drift apart.
          </p>
        </div>
        <dl className="ident">
          <div>
            <dt>run</dt>
            <dd>{data.runId}</dd>
          </div>
          <div>
            <dt>subject</dt>
            <dd>{data.subjectLabel ?? "unknown"}</dd>
          </div>
          <div>
            <dt>suite</dt>
            <dd>{data.suite ?? "ad hoc"}</dd>
          </div>
          <div>
            <dt>mode</dt>
            <dd>{data.mode}</dd>
          </div>
        </dl>
      </header>

      <p className="notice warn">
        <strong>This subject is not a language model.</strong>
        <span>
          The run below comes from <code>echo</code>, a deterministic test double that always picks
          the first option it is shown. It exists to exercise the pipeline. Every rate and effect on
          this page is real arithmetic over real rows, and none of it says anything whatsoever about
          any model&rsquo;s moral judgement.
        </span>
      </p>

      <section className="panel">
        <h2>Outcomes</h2>
        <div className="stat-row">
          <Stat
            label="act rate"
            value={o.actRate === null ? "n/a" : `${(o.actRate * 100).toFixed(1)}%`}
            note={`of ${o.nValid} valid answers`}
          />
          <Stat label="refusal" value={`${(o.refusalRate * 100).toFixed(1)}%`} note={`${o.counts.refusal} rows`} />
          <Stat
            label="unparseable"
            value={`${(o.unparseableRate * 100).toFixed(1)}%`}
            note={`${o.counts.unparseable} rows`}
          />
          <Stat label="error" value={`${(o.errorRate * 100).toFixed(1)}%`} note={`${o.counts.error} rows`} />
          <Stat label="subjects" value={String(data.clusters)} note="bootstrap clusters" />
        </div>
        <p className="foot-note">
          The denominator for the act rate is <em>act + omit</em> only. Refusals, unparseable
          responses, Likert ratings and transport errors are reported beside it and never folded in
          — that is schema invariant 2, and it is where moral-dilemma evaluations usually go wrong.
          {o.actRate === null ? " With no valid answers the act rate is undefined, not zero." : ""}
          {data.superseded > 0
            ? ` ${data.superseded} superseded row(s) were ignored; the newest attempt at each cell wins.`
            : ""}
          {data.orphans > 0
            ? ` ${data.orphans} row(s) could not be joined to an instance and are excluded.`
            : ""}
        </p>
      </section>

      <section className={positional ? "panel alarm" : "panel"}>
        <h2>Option-order consistency</h2>
        {flip === null ? (
          <p>
            No cell was answered under both orderings, so there is nothing to compare.{" "}
            {data.consistency?.unpaired ?? 0} unpaired.
          </p>
        ) : (
          <>
            <div className="stat-row">
              <Stat
                label="flip rate"
                value={`${(flip * 100).toFixed(1)}%`}
                note={`over ${data.consistency!.pairs} pairs`}
              />
              <Stat
                label="interval"
                value={
                  data.consistency!.ci
                    ? `${(data.consistency!.ci[0] * 100).toFixed(0)}–${(data.consistency!.ci[1] * 100).toFixed(0)}%`
                    : "not estimable"
                }
                note="95%, clustered on subject"
              />
              <Stat label="unpaired" value={String(data.consistency!.unpaired)} note="one side missing or refused" />
            </div>
            <p className="foot-note">
              {positional ? (
                <>
                  <strong>Read every effect on this page as an artefact until this is explained.</strong>{" "}
                  At this rate the answers track <em>where an option sits</em> rather than what it
                  says, which is exactly what the <code>echo</code> stub does by construction. A fair
                  coin flips 50% of the time; that is the ceiling of meaninglessness, not 100%.
                </>
              ) : (
                <>
                  Option order is a control in this design, always run and never averaged away,
                  because a model whose answer tracks position is not expressing a judgement at all.
                </>
              )}
            </p>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Average marginal component effects</h2>
        <Forest data={data} />
      </section>

      <section className="panel">
        <h2>Where refusal concentrates</h2>
        <p className="foot-note">
          An aggregate refusal rate hides the thing worth knowing. Refusal is almost never uniform,
          and a low <em>n valid</em> concentrated in the exact cells an effect is claimed from is a
          different problem from one spread evenly.
        </p>
        <ul className="bars">
          {data.refusalByTemplate.map((t) => (
            <li key={t.group}>
              <span className="bar-label">
                <code>{t.group}</code>
              </span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${Math.max(1.5, t.refusalRate * 100)}%` }} />
              </span>
              <span className="bar-value">
                {(t.refusalRate * 100).toFixed(1)}%<span className="of"> of {t.n}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="foot">
        <Link href="/">← scenario workbench</Link>
        <span>
          {data.toolVersion ? `trolley ${data.toolVersion}` : null}
          {data.startedAt ? ` · run started ${data.startedAt.slice(0, 19).replace("T", " ")} UTC` : null}
        </span>
      </footer>
    </main>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-note">{note}</span>
    </div>
  );
}

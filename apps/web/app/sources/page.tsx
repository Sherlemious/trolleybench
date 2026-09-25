import { loadSources, MEASURE_LABEL, type UiReference } from "../../lib/sources";
import SiteNav from "../SiteNav";

export const dynamic = "force-static";

export const metadata = {
  title: "Sources · trolleybench",
  description:
    "Where every human baseline and scenario citation comes from, with the verbatim text each number was read from.",
};

export default async function SourcesPage() {
  const data = await loadSources();

  // Baselines grouped under their scenario, in the order the scenarios first appear.
  const groups = new Map<string, typeof data.baselines>();
  for (const b of data.baselines) {
    const list = groups.get(b.templateId) ?? [];
    list.push(b);
    groups.set(b.templateId, list);
  }

  const agentChecked = data.references.filter((r) => r.checked?.by === "agent").length;
  const humanVerified = data.references.filter((r) => r.verified).length;

  return (
    <main className="wrap">
      <SiteNav current="sources" />

      <header className="page-head">
        <div>
          <p className="eyebrow">Sources</p>
          <h1>Where the numbers come from</h1>
          <p className="lede">
            Each human baseline on the results page is traceable to a published source, with the exact
            sentence its number was read from. A wrong citation propagates into every comparison drawn
            from it, so the status of each one is stated rather than implied.
          </p>
        </div>
      </header>

      <section className="kpis" aria-label="Verification status">
        <div className="kpi">
          <span className="kpi-label">references</span>
          <span className="kpi-value">{data.references.length}</span>
          <span className="kpi-note">{data.baselines.length} baseline measurements</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">checked against text</span>
          <span className="kpi-value">{agentChecked}</span>
          <span className="kpi-note">read by an agent, 2026-09-25</span>
        </div>
        <div className={humanVerified === 0 ? "kpi bad" : "kpi"}>
          <span className="kpi-label">human-verified</span>
          <span className="kpi-value">{humanVerified}</span>
          <span className="kpi-note">required before publication</span>
        </div>
      </section>

      <p className="notice">
        <strong>Not yet verified by a person.</strong>
        <span>
          &ldquo;Checked&rdquo; means an automated agent opened the linked text and confirmed the
          details and quoted numbers against it. That is not verification: until a researcher confirms
          each source against the published version, treat these as leads. Where the only accessible
          text was someone else&rsquo;s report of a study, the baseline says <em>via</em> and names it.
        </span>
      </p>

      <section className="panel">
        <div className="panel-head">
          <h2>Human baselines</h2>
          <span className="hint">share endorsing the act option, unless stated</span>
        </div>
        <div className="panel-body src-groups">
          {[...groups].map(([templateId, list]) => (
            <div className="src-group" key={templateId}>
              <h3>{data.templateTitles[templateId] ?? templateId}</h3>
              <ul className="src-list">
                {list.map((b) => {
                  const ref = data.byKey[b.citekey];
                  const via = b.via ? data.byKey[b.via] : null;
                  return (
                    <li key={b.id} className="src">
                      <div className="src-num">
                        {b.value !== null ? (
                          <>
                            <span className="big">{Math.round(b.value * 100)}%</span>
                            {b.ci ? (
                              <span className="ci">
                                {Math.round(b.ci[0] * 100)}–{Math.round(b.ci[1] * 100)}%
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="big small">ratings</span>
                        )}
                        <span className="measure">{MEASURE_LABEL[b.measure]}</span>
                      </div>
                      <div className="src-body">
                        <p className="src-cite">
                          <Cite r={ref} fallback={b.citekey} />
                          {via ? (
                            <>
                              {" "}
                              <span className="via">
                                via <Cite r={via} fallback={b.via!} />
                              </span>
                            </>
                          ) : null}
                        </p>
                        <p className="src-meta">
                          {b.asked} · {b.population}
                          {b.n ? ` · n = ${b.n.toLocaleString("en")}` : ""}
                        </p>
                        {b.finding ? <p className="src-finding">{b.finding}</p> : null}
                        <blockquote>&ldquo;{b.quote}&rdquo;</blockquote>
                        {b.note ? <p className="src-note">{b.note}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Bibliography</h2>
          <span className="hint">every citekey used by the packs and the baselines</span>
        </div>
        <div className="panel-body">
          <ol className="bib">
            {data.references.map((r) => (
              <li key={r.citekey} id={r.citekey}>
                <p>
                  {r.full}{" "}
                  {r.href ? (
                    <a href={r.href} target="_blank" rel="noreferrer">
                      {r.doi ? `doi:${r.doi}` : "link"}
                    </a>
                  ) : null}
                </p>
                <p className="bib-meta">
                  <code>{r.citekey}</code>
                  <Status r={r} />
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="foot">
        <span>
          Source files: <code>content/papers/references.yaml</code> and{" "}
          <code>content/baselines/human.yaml</code>. A test fails if a citekey does not resolve, if a
          quoted number and its value disagree, or if anything is marked verified without a human.
        </span>
      </footer>
    </main>
  );
}

function Cite({ r, fallback }: { r: UiReference | undefined; fallback: string }) {
  if (!r) return <code>{fallback}</code>;
  return r.href ? (
    <a href={r.href} target="_blank" rel="noreferrer">
      {r.short}
    </a>
  ) : (
    <span>{r.short}</span>
  );
}

function Status({ r }: { r: UiReference }) {
  if (r.verified) return <span className="badge ok">verified</span>;
  if (r.checked) {
    return (
      <span className="badge checked" title={`checked by ${r.checked.by} on ${r.checked.on}`}>
        checked by {r.checked.by} ·{" "}
        <a href={r.checked.against} target="_blank" rel="noreferrer">
          text read
        </a>
      </span>
    );
  }
  return <span className="badge">unverified</span>;
}

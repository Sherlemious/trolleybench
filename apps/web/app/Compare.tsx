import type { Comparison, UiRate } from "../lib/analysis";
import { MEASURE_LABEL } from "../lib/sources";

/**
 * People versus the model, one small multiple per scenario, on a shared 0-100% axis.
 *
 * Encoding: a published human result is a hollow marker in ink; the model is a filled
 * marker in the accent colour. Identity is carried by shape and by the row label as
 * well as colour, so nothing depends on telling two hues apart.
 *
 * The two intervals are not the same kind of thing, and the drawing keeps them apart:
 * a study's interval is what that paper reported; the model's is a Wilson interval over
 * this run's answers on these cells. Neither says how far apart the two populations
 * are, because the question wording and the measure differ - which is why the row
 * label names the measure.
 */
export default function Compare({
  comparisons,
  subject,
}: {
  comparisons: Comparison[];
  subject: string;
}) {
  if (comparisons.length === 0) {
    return <p className="empty">No scenario in this run has a published human baseline.</p>;
  }

  return (
    <div className="compare">
      <div className="cmp-legend" aria-hidden="true">
        <span>
          <i className="mk human" /> published human result
        </span>
        <span>
          <i className="mk model" /> {subject}
        </span>
        <span>
          <i className="wk" /> 95% interval
        </span>
      </div>

      {comparisons.map((c) => (
        <section className="cmp" key={c.templateId} aria-labelledby={`cmp-${c.templateId}`}>
          <header className="cmp-head">
            <h3 id={`cmp-${c.templateId}`}>{c.title}</h3>
            <span className="cmp-cells">model cells: {c.cells}</span>
          </header>

          <div className="cmp-rows" role="list">
            <Axis />
            {c.baselines
              .filter((b) => b.value !== null)
              .map((b) => (
                <Row
                  key={b.id}
                  kind="human"
                  label={
                    b.href ? (
                      <a href={b.href} target="_blank" rel="noreferrer">
                        {b.short}
                      </a>
                    ) : (
                      b.short
                    )
                  }
                  sub={`${MEASURE_LABEL[b.measure]}${b.n ? ` · n=${b.n.toLocaleString("en")}` : ""}${b.viaShort ? ` · via ${b.viaShort}` : ""}`}
                  value={b.value}
                  interval={b.ci}
                  tip={`${b.short}: ${pct(b.value)} ${MEASURE_LABEL[b.measure]}${b.ci ? ` (95% CI ${pct(b.ci[0])}–${pct(b.ci[1])})` : ""}. ${b.population}.`}
                />
              ))}

            {c.byLevel.length > 0
              ? c.byLevel.map((l) => (
                  <Row
                    key={l.level}
                    kind="model"
                    label={l.level}
                    sub={`${subject} · chose act · n=${l.rate.nValid}${l.rate.refusal ? ` · ${l.rate.refusal} refused` : ""}`}
                    value={l.rate.actRate}
                    interval={l.rate.interval}
                    tip={modelTip(subject, l.rate, l.level)}
                  />
                ))
              : (
                  <Row
                    kind="model"
                    label={subject}
                    sub={
                      c.model
                        ? `chose act · n=${c.model.nValid}${c.model.refusal ? ` · ${c.model.refusal} refused` : ""}`
                        : "no answers on these cells"
                    }
                    value={c.model?.actRate ?? null}
                    interval={c.model?.interval ?? null}
                    tip={c.model ? modelTip(subject, c.model) : `${subject}: no answers on these cells`}
                  />
                )}
          </div>

          {c.baselines
            .filter((b) => b.finding)
            .map((b) => (
              <p className="cmp-finding" key={b.id}>
                <strong>
                  {b.href ? (
                    <a href={b.href} target="_blank" rel="noreferrer">
                      {b.short}
                    </a>
                  ) : (
                    b.short
                  )}
                  :
                </strong>{" "}
                {b.finding} <Direction comparison={c} />
              </p>
            ))}
        </section>
      ))}
    </div>
  );
}

/** For the qualitative Greene contrast: does the model reproduce trapdoor > footbridge? */
function Direction({ comparison }: { comparison: Comparison }) {
  const rate = (level: string) => comparison.byLevel.find((l) => l.level === level)?.rate.actRate ?? null;
  const trapdoor = rate("trapdoor");
  const footbridge = rate("footbridge");
  if (trapdoor === null || footbridge === null) return null;
  const same = trapdoor > footbridge;
  const n = Math.min(...comparison.byLevel.map((l) => l.rate.nValid));
  return (
    <span className={same ? "dir agree" : "dir differ"}>
      {same ? "✓" : "✗"} The model {same ? "shows the same direction" : "does not show this direction"}: trapdoor{" "}
      {pct(trapdoor)} vs footbridge {pct(footbridge)}.
      {n < 10 ? (
        <span className="dir-n"> With {n} answers per level this is an observation, not evidence.</span>
      ) : null}
    </span>
  );
}

function Axis() {
  return (
    <div className="cmp-row cmp-axis" aria-hidden="true">
      <span className="cmp-label" />
      <span className="cmp-track">
        {[0, 25, 50, 75, 100].map((t) => (
          <span key={t} className="tick" style={{ left: `${t}%` }}>
            {t}%
          </span>
        ))}
      </span>
      <span className="cmp-value" />
    </div>
  );
}

function Row({
  kind,
  label,
  sub,
  value,
  interval,
  tip,
}: {
  kind: "human" | "model";
  label: React.ReactNode;
  sub: string;
  value: number | null;
  interval: [number, number] | null;
  tip: string;
}) {
  return (
    <div className={`cmp-row ${kind}`} role="listitem">
      <span className="cmp-label">
        <span className="who">{label}</span>
        <span className="sub">{sub}</span>
      </span>
      <span className="cmp-track">
        {interval ? (
          <span
            className="whisker"
            style={{ left: `${interval[0] * 100}%`, width: `${(interval[1] - interval[0]) * 100}%` }}
          />
        ) : null}
        {value !== null ? (
          <span className={`mk ${kind}`} style={{ left: `${value * 100}%` }} tabIndex={0} data-tip={tip} aria-label={tip} />
        ) : null}
      </span>
      <span className="cmp-value">{pct(value)}</span>
    </div>
  );
}

function modelTip(subject: string, r: UiRate, level?: string): string {
  return `${subject}${level ? ` (${level})` : ""}: chose act on ${pct(r.actRate)} of ${r.nValid} valid answers${
    r.interval ? `, 95% Wilson interval ${pct(r.interval[0])}–${pct(r.interval[1])}` : ""
  }${r.refusal ? `; ${r.refusal} refused` : ""}.`;
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

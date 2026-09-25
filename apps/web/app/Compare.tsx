import type { Comparison, ModelOnScenario, UiRate } from "../lib/analysis";
import { MEASURE_LABEL } from "../lib/sources";

/**
 * People versus models, one small multiple per scenario, on a shared 0-100% axis.
 *
 * Encoding: a published human result is a hollow marker in ink; each model is a filled
 * marker in its own categorical slot, kept for good so adding a model never repaints
 * the others. Every row is labelled, so identity never rests on colour alone.
 *
 * The intervals are not the same kind of thing, and the drawing keeps them apart: a
 * study's interval is what that paper reported; a model's is a Wilson interval over its
 * answers on these cells. Neither says how far apart the populations are, because the
 * wording and the measure differ - which is why each human row names its measure.
 */
export default function Compare({ comparisons }: { comparisons: Comparison[] }) {
  if (comparisons.length === 0) {
    return <p className="empty">No scenario here has a published human baseline.</p>;
  }
  const models = comparisons[0]!.models.map((m) => m.run);

  return (
    <div className="compare">
      <div className="cmp-legend" aria-hidden="true">
        <span>
          <i className="mk human" /> published human result
        </span>
        {models.map((r) => (
          <span key={r.id}>
            <i className={`mk model s${r.slot}`} /> {r.label}
          </span>
        ))}
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

            {c.models.map((m) =>
              m.byLevel.length > 0 ? (
                m.byLevel.map((l) => (
                  <Row
                    key={`${m.run.id}-${l.level}`}
                    kind="model"
                    slot={m.run.slot}
                    label={l.level}
                    sub={`${m.run.label} · chose act · n=${l.rate.nValid}${l.rate.refusal ? ` · ${l.rate.refusal} refused` : ""}`}
                    value={l.rate.actRate}
                    interval={l.rate.interval}
                    tip={modelTip(m.run.label, l.rate, l.level)}
                  />
                ))
              ) : (
                <Row
                  key={m.run.id}
                  kind="model"
                  slot={m.run.slot}
                  label={m.run.label}
                  sub={
                    m.rate
                      ? `chose act · n=${m.rate.nValid}${m.rate.refusal ? ` · ${m.rate.refusal} refused` : ""}`
                      : "no answers on these cells"
                  }
                  value={m.rate?.actRate ?? null}
                  interval={m.rate?.interval ?? null}
                  tip={m.rate ? modelTip(m.run.label, m.rate) : `${m.run.label}: no answers on these cells`}
                />
              ),
            )}
          </div>

          {c.baselines
            .filter((b) => b.finding)
            .map((b) => (
              <div className="cmp-finding" key={b.id}>
                <p>
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
                  {b.finding}
                </p>
                {c.models.map((m) => (
                  <Direction key={m.run.id} model={m} />
                ))}
              </div>
            ))}
        </section>
      ))}
    </div>
  );
}

/** For the qualitative Greene contrast: does the model reproduce trapdoor > footbridge? */
function Direction({ model }: { model: ModelOnScenario }) {
  const rate = (level: string) => model.byLevel.find((l) => l.level === level)?.rate.actRate ?? null;
  const trapdoor = rate("trapdoor");
  const footbridge = rate("footbridge");
  if (trapdoor === null || footbridge === null) return null;
  const same = trapdoor > footbridge;
  const n = Math.min(...model.byLevel.map((l) => l.rate.nValid));
  return (
    <p className={same ? "dir agree" : "dir differ"}>
      {same ? "✓" : "✗"} {model.run.label} {same ? "shows the same direction" : "does not show this direction"}: trapdoor{" "}
      {pct(trapdoor)} vs footbridge {pct(footbridge)}.
      {n < 10 ? <span className="dir-n"> With {n} answers per level this is an observation, not evidence.</span> : null}
    </p>
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
  slot,
  label,
  sub,
  value,
  interval,
  tip,
}: {
  kind: "human" | "model";
  slot?: number;
  label: React.ReactNode;
  sub: string;
  value: number | null;
  interval: [number, number] | null;
  tip: string;
}) {
  const s = kind === "model" ? ` s${slot ?? 1}` : "";
  return (
    <div className={`cmp-row ${kind}${s}`} role="listitem">
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
          <span
            className={`mk ${kind}${s}`}
            style={{ left: `${value * 100}%` }}
            tabIndex={0}
            data-tip={tip}
            aria-label={tip}
          />
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

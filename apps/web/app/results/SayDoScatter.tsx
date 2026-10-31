"use client";

import Link from "next/link";
import { displayName } from "../../lib/display";
import { useFocus } from "../focus";

export interface ScatterPoint {
  key: string;
  label: string;
  slot: number;
  /** Act rate when asked (prompt mode). */
  x: number;
  /** Act rate when acting (mcp_tool mode). */
  y: number;
  nx: number;
  ny: number;
  askedId: string;
  actingId: string;
}

/** Points within this many points of the diagonal count as "about the same". */
const SAME = 0.05;
/** Up to this many models, every dot is labelled and the summary is a sentence. */
const LABEL_MAX = 8;
/** From this many models, the summary is three counts. Below it, counts are mostly zeros. */
const TILES_MIN = 10;

/**
 * Asked against acting, one point per model measured both ways. The diagonal is "does
 * what it says"; above it, a model acts more when it can than it says it would. Scales to
 * any number of models, unlike a row per model.
 *
 * The two coordinates come from separate runs, so a point's distance from the diagonal is
 * a pointer to look closer, not an effect estimate - the copy beside the plot says so.
 */
export default function SayDoScatter({ points, notBoth }: { points: ScatterPoint[]; notBoth: number }) {
  const { numberOf, focus, toggle } = useFocus();
  if (points.length === 0) return null;

  const more = points.filter((p) => p.y - p.x > SAME).length;
  const less = points.filter((p) => p.x - p.y > SAME).length;
  const same = points.length - more - less;
  const focused = points.filter((p) => numberOf(p.key) > 0);
  const labelled = points.length <= LABEL_MAX;

  return (
    <div className={`sdx${focus.length ? " has-focus" : ""}`}>
      <div className="sdx-plot" role="img" aria-label={`Scatter of ${points.length} models: act rate when asked against act rate when acting.`}>
        <div className="sdx-area" />
        <svg className="sdx-diag" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="100" x2="100" y2="0" />
        </svg>
        <span className="sdx-zone up">Acts more than it says</span>
        <span className="sdx-zone down">Says more than it acts</span>
        {[0, 25, 50, 75, 100].map((t) => (
          <span key={`x${t}`} className="sdx-tk x" style={{ left: `${t}%` }}>
            {t}%
          </span>
        ))}
        {[0, 25, 50, 75, 100].map((t) => (
          <span key={`y${t}`} className="sdx-tk y" style={{ bottom: `${t}%` }}>
            {t}%
          </span>
        ))}
        <span className="sdx-ax x">Asked: chose to act</span>
        <span className="sdx-ax y">Acting: chose to act</span>
        {points.map((p) => (
          <button
            type="button"
            tabIndex={-1}
            key={p.key + p.askedId + p.actingId}
            className={`sdx-pt s${p.slot}${numberOf(p.key) ? " on" : ""}`}
            style={{ left: `${p.x * 100}%`, bottom: `${p.y * 100}%` }}
            data-tip={tip(p)}
            aria-label={tip(p)}
            onClick={() => toggle(p.key)}
          />
        ))}
        {labelled
          ? points.map((p) => (
              <span
                key={`l${p.key}${p.askedId}`}
                className={`sdx-label${p.x > 0.7 ? " left" : ""}`}
                style={{ left: `${p.x * 100}%`, bottom: `${p.y * 100}%` }}
                aria-hidden="true"
              >
                {displayName(p.label).name}
              </span>
            ))
          : null}
        {focused.map((p) => (
          <Link
            key={`f${p.key}${p.askedId}`}
            href={`/results/${encodeURIComponent(p.actingId)}`}
            className={`fmk s${p.slot}`}
            style={{ left: `${p.x * 100}%`, bottom: `${p.y * 100}%` }}
            data-tip={tip(p)}
            aria-label={tip(p)}
          >
            {numberOf(p.key)}
          </Link>
        ))}
      </div>
      <div className="sdx-side">
        {points.length >= TILES_MIN ? (
          <dl className="sdx-stats">
            <div>
              <dt>Act more when acting</dt>
              <dd>{more}</dd>
            </div>
            <div>
              <dt>About the same</dt>
              <dd>{same}</dd>
            </div>
            <div>
              <dt>Act less when acting</dt>
              <dd>{less}</dd>
            </div>
          </dl>
        ) : (
          <p className="sdx-sentence">{sentence(points)}</p>
        )}
        <p>
          Each dot is one model measured both ways. On the dashed line, a model does what it says. &ldquo;About the same&rdquo; means within{" "}
          {Math.round(SAME * 100)} points. Click a dot to highlight that model everywhere on the page.
        </p>
        {notBoth > 0 ? (
          <p className="muted">
            {notBoth} more model{notBoth === 1 ? " was" : "s were"} measured only one way, so {notBoth === 1 ? "it is" : "they are"} in the table below and not here.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The small-number summary: who moved which way, in words, with the gap. */
function sentence(points: ScatterPoint[]): string {
  const gap = (p: ScatterPoint) => Math.round((p.y - p.x) * 100);
  const name = (p: ScatterPoint) => `${displayName(p.label).name} (${gap(p) > 0 ? "+" : gap(p) < 0 ? "−" : "±"}${Math.abs(gap(p))} pts)`;
  const groups: Array<[string, ScatterPoint[]]> = [
    ["act less when they have tools than when asked", points.filter((p) => p.x - p.y > SAME)],
    ["act more when they have tools than when asked", points.filter((p) => p.y - p.x > SAME)],
    ["do about what they say, within 5 points", points.filter((p) => Math.abs(p.y - p.x) <= SAME)],
  ];
  const parts = groups.filter(([, g]) => g.length > 0);
  if (points.length === 1) {
    const [label] = parts[0]!;
    return `${name(points[0]!)} ${label.replace(/^act/, "acts").replace(/^do /, "does ").replace("they have", "it has").replace("they say", "it says")}.`;
  }
  return parts
    .map(([label, g], i) => {
      const who = g.length === points.length ? (g.length === 2 ? "Both" : `All ${g.length}`) : `${g.length} of ${points.length}`;
      return `${i === 0 ? who : who.toLowerCase()} ${label}: ${g.map(name).join(", ")}`;
    })
    .join("; ")
    .concat(".");
}

function tip(p: ScatterPoint): string {
  const d = displayName(p.label);
  return `${d.name}${d.channel ? ` (${d.channel})` : ""}: asked ${Math.round(p.x * 100)}% (n=${p.nx}), acting ${Math.round(p.y * 100)}% (n=${p.ny}).`;
}

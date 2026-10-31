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

function tip(p: ScatterPoint): string {
  const d = displayName(p.label);
  return `${d.name}${d.channel ? ` (${d.channel})` : ""}: asked ${Math.round(p.x * 100)}% (n=${p.nx}), acting ${Math.round(p.y * 100)}% (n=${p.ny}).`;
}

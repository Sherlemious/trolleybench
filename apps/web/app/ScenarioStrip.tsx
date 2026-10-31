"use client";

import Link from "next/link";
import { displayName, shortName } from "../lib/display";
import { useFocus } from "./focus";

/**
 * One scenario on one 0-100% axis: what people said, and where every model landed.
 *
 * Built to stay one compact block whether there are 3 models or 300:
 *  - People: each published result is a hollow ink marker, and the span between them is a
 *    soft band drawn behind every lane, so "inside or outside the human range" is visible
 *    at a glance without claiming the studies measured the same thing.
 *  - Models, per lane (asked, acting, a factor level): a beeswarm of small dots in the
 *    company's colour. Past SWARM_MAX models, or when the dots would stack too tall, the
 *    lane becomes a stacked histogram in 5-point bins: same colours, no lost dots.
 *  - Focus: models the reader picked are drawn on top as numbered markers, with their
 *    interval, so six named models and two hundred anonymous ones share one picture.
 *  - You: on the play page, a vertical line where the reader's own answer sits.
 *
 * Colour never carries identity alone: every mark has a tooltip naming it, the focus
 * markers are numbered, and the table beside the chart has every value.
 */

export interface StripPoint {
  /** modelKey(label): what focus is keyed on. */
  key: string;
  /** The entry id, for the link to its run page. */
  id: string;
  label: string;
  value: number;
  n: number;
  interval: [number, number] | null;
  slot: number;
}

export interface StripLane {
  id: string;
  label: string;
  points: StripPoint[];
}

export interface StripHuman {
  id: string;
  label: string;
  value: number;
  note?: string;
  href?: string | null;
}

const SWARM_MAX = 60;
/** Half the swarm's height, in dot rows either side of the centre line. */
const MAX_LEVEL = 3;
/** Two dots closer than this (in % of the axis) cannot share a row. */
const SEP = 1.5;
const BINS = 20;

export default function ScenarioStrip({
  title,
  humans,
  lanes,
  you,
  sub,
  intervals = true,
}: {
  title?: React.ReactNode;
  humans: StripHuman[];
  lanes: StripLane[];
  you?: { value: number; label?: string } | null;
  sub?: React.ReactNode;
  /** Draw focus markers' intervals. */
  intervals?: boolean;
}) {
  const { numberOf, focus, toggle } = useFocus();
  const hv = humans.map((h) => h.value);
  const band = hv.length ? ([Math.min(...hv), Math.max(...hv)] as const) : null;
  const anyFocus = focus.length > 0;

  const bandEl = band ? (
    <span className="st-band" style={{ left: pc(band[0]), width: `max(3px, ${(band[1] - band[0]) * 100}%)` }} aria-hidden="true" />
  ) : null;
  const youEl = you ? <span className="st-you" style={{ left: pc(you.value) }} aria-hidden="true" /> : null;

  return (
    <figure className={`strip${anyFocus ? " has-focus" : ""}`}>
      {title || sub ? (
        <figcaption className="st-head">
          {title ? <span className="st-title">{title}</span> : null}
          {sub ? <span className="st-sub">{sub}</span> : null}
        </figcaption>
      ) : null}

      <div className="st-grid">
        {humans.length > 0 ? (
          <div className="st-row st-people">
            <span className="st-label">
              People
              <span className="st-n">
                {humans.length} stud{humans.length === 1 ? "y" : "ies"}
              </span>
            </span>
            <span className="st-track">
              {bandEl}
              {youEl}
              {you ? (
                <span className="st-you-tag" style={{ left: pc(you.value) }}>
                  {you.label ?? "You"}
                </span>
              ) : null}
              {humans.map((h) => (
                <span
                  key={h.id}
                  className="st-human"
                  style={{ left: pc(h.value) }}
                  tabIndex={0}
                  data-tip={`${h.label}: ${pct(h.value)}${h.note ? ` ${h.note}` : ""}`}
                  aria-label={`${h.label}: ${pct(h.value)}${h.note ? ` ${h.note}` : ""}`}
                />
              ))}
            </span>
            <span className="st-sum">{band ? (band[0] === band[1] ? pct(band[0]) : `${pct(band[0])}–${pct(band[1])}`) : ""}</span>
          </div>
        ) : null}

        {lanes.map((lane) => (
          <Lane key={lane.id} lane={lane} band={bandEl} you={youEl} numberOf={numberOf} toggle={toggle} intervals={intervals} />
        ))}

        <div className="st-row st-axis" aria-hidden="true">
          <span className="st-label" />
          <span className="st-track">
            {[0, 25, 50, 75, 100].map((t) => (
              <span key={t} className="st-tick" style={{ left: `${t}%` }}>
                {t}%
              </span>
            ))}
          </span>
          <span className="st-sum" />
        </div>
      </div>
    </figure>
  );
}

function Lane({
  lane,
  band,
  you,
  numberOf,
  toggle,
  intervals,
}: {
  lane: StripLane;
  band: React.ReactNode;
  you: React.ReactNode;
  numberOf: (k: string) => number;
  toggle: (k: string) => void;
  intervals: boolean;
}) {
  const pts = lane.points;
  const vals = pts.map((p) => p.value).sort((a, b) => a - b);
  const median = vals.length ? vals[Math.floor((vals.length - 1) / 2)]! : null;
  const placed = pts.length <= SWARM_MAX ? swarm(pts) : null;
  const histogram = placed === null;
  const focused = pts.filter((p) => numberOf(p.key) > 0).sort((a, b) => numberOf(a.key) - numberOf(b.key));

  return (
    <div className={`st-row st-lane${histogram ? " hist" : ""}`}>
      <span className="st-label">
        {lane.label}
        <span className="st-n">
          {pts.length} model{pts.length === 1 ? "" : "s"}
        </span>
      </span>
      <span className="st-track">
        {band}
        {you}
        {median !== null ? <span className="st-median" style={{ left: pc(median) }} aria-hidden="true" /> : null}
        {histogram ? (
          <Histogram points={pts} />
        ) : (
          placed!.map(({ p, level }) => (
            <button
              type="button"
              key={`${p.id}-${p.key}`}
              tabIndex={-1}
              className={`st-dot s${p.slot}${numberOf(p.key) ? " on" : ""}${p.n < 6 ? " thin" : ""}`}
              style={{ left: pc(p.value), top: `calc(50% + ${level * 7}px)` }}
              data-tip={tipFor(p)}
              aria-label={tipFor(p)}
              onClick={() => toggle(p.key)}
            />
          ))
        )}
        {focused.map((p, i) => {
          // Markers that land together stack rather than hide each other.
          const shift = focused.slice(0, i).filter((q) => Math.abs(q.value - p.value) < 0.025).length;
          return <FocusMark key={`f-${p.id}`} p={p} n={numberOf(p.key)} intervals={intervals} shift={shift} />;
        })}
      </span>
      <span className="st-sum">
        {median === null ? (
          <span className="muted">not run</span>
        ) : (
          <>
            <span className="st-med-label">median</span> {pct(median)}
          </>
        )}
      </span>
    </div>
  );
}

function FocusMark({ p, n, intervals, shift }: { p: StripPoint; n: number; intervals: boolean; shift: number }) {
  const thin = p.n < 10;
  return (
    <>
      {intervals && p.interval ? (
        <span
          className={`st-ci s${p.slot}${thin ? " thin" : ""}`}
          style={{ left: pc(p.interval[0]), width: `${(p.interval[1] - p.interval[0]) * 100}%` }}
          aria-hidden="true"
        />
      ) : null}
      <Link
        href={`/results/${encodeURIComponent(p.id)}`}
        className={`fmk st-fmk s${p.slot}`}
        style={{ left: pc(p.value), ["--shift" as string]: shift }}
        data-tip={`${tipFor(p)}${thin ? " Few answers: read the interval, not the dot." : ""}`}
        aria-label={tipFor(p)}
      >
        {n}
      </Link>
    </>
  );
}

/** Stacked 5-point bins, one segment per company, for lanes too crowded to swarm. */
function Histogram({ points }: { points: StripPoint[] }) {
  const bins: StripPoint[][] = Array.from({ length: BINS }, () => []);
  for (const p of points) bins[Math.min(BINS - 1, Math.floor(p.value * BINS))]!.push(p);
  const most = Math.max(1, ...bins.map((b) => b.length));
  return (
    <>
      {bins.map((b, i) => {
        if (b.length === 0) return null;
        const bySlot = new Map<number, number>();
        for (const p of b) bySlot.set(p.slot, (bySlot.get(p.slot) ?? 0) + 1);
        const names = b
          .slice()
          .sort((x, y) => y.value - x.value)
          .map((p) => shortName(p.label));
        const tip = `${b.length} model${b.length === 1 ? "" : "s"} at ${i * 5}–${(i + 1) * 5}%: ${names.slice(0, 8).join(", ")}${names.length > 8 ? `, and ${names.length - 8} more` : ""}`;
        return (
          <span
            key={i}
            className="st-bin"
            style={{ left: `${(i / BINS) * 100}%`, width: `${100 / BINS}%`, height: `${(b.length / most) * 100}%` }}
            tabIndex={0}
            data-tip={tip}
            aria-label={tip}
          >
            {[...bySlot].sort((a, c) => a[0] - c[0]).map(([slot, count]) => (
              <i key={slot} className={`s${slot}`} style={{ flexGrow: count }} />
            ))}
          </span>
        );
      })}
    </>
  );
}

/**
 * Deterministic beeswarm: dots sorted by value, each placed on the row nearest the centre
 * line (0, +1, -1, +2, ...) where it overlaps nothing. Returns null if some dot finds no
 * row within MAX_LEVEL, which is the cue to draw a histogram instead.
 */
function swarm(points: StripPoint[]): Array<{ p: StripPoint; level: number }> | null {
  const sorted = points.slice().sort((a, b) => a.value - b.value || a.key.localeCompare(b.key));
  const rows = new Map<number, number>(); // level -> right-most value placed on it
  const order = [0];
  for (let l = 1; l <= MAX_LEVEL; l++) order.push(-l, l);
  const out: Array<{ p: StripPoint; level: number }> = [];
  for (const p of sorted) {
    const v = p.value * 100;
    const level = order.find((l) => {
      const last = rows.get(l);
      return last === undefined || v - last >= SEP;
    });
    if (level === undefined) return null;
    rows.set(level, v);
    out.push({ p, level });
  }
  return out;
}

function tipFor(p: StripPoint): string {
  const d = displayName(p.label);
  return `${d.name}${d.channel ? ` (${d.channel})` : ""}: chose act ${pct(p.value)} of ${p.n} answers${
    p.interval ? `, 95% interval ${pct(p.interval[0])}–${pct(p.interval[1])}` : ""
  }.`;
}

function pc(v: number): string {
  return `${Math.max(0, Math.min(1, v)) * 100}%`;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { displayName, shortChannel } from "../../lib/display";
import type { ClientSummary, TogetherRow } from "../../lib/view/results";
import { useFocus } from "../focus";

const LIMIT = 8;

function gap(r: TogetherRow): number | null {
  const a = r.asked[0]?.overall.actRate;
  const d = r.acting[0]?.overall.actRate;
  return a != null && d != null ? d - a : null;
}

/** Asked against acting as rows: highlighted models first, then the largest gaps, the rest one click away. */
export default function Together({ rows }: { rows: TogetherRow[] }) {
  const { numberOf } = useFocus();
  const [all, setAll] = useState(false);
  const list = rows.slice().sort((a, b) => {
    const fa = numberOf(a.key) || 99;
    const fb = numberOf(b.key) || 99;
    if (fa !== fb) return fa - fb;
    const ga = gap(a);
    const gb = gap(b);
    if ((ga === null) !== (gb === null)) return ga === null ? 1 : -1;
    return Math.abs(gb ?? 0) - Math.abs(ga ?? 0) || a.label.localeCompare(b.label);
  });
  const shown = all ? list : list.slice(0, LIMIT);
  return (
    <>
      <h3 className="sub-h">Largest differences{list.length > LIMIT && !all ? ` (${LIMIT} of ${list.length})` : ""}</h3>
      <div className="model-table-wrap">
        <table className="model-table together">
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col" className="num">
                Asked · chose to act
              </th>
              <th scope="col" className="num">
                Acting · chose to act
              </th>
              <th scope="col" className="num" title="Acting minus asked, in percentage points. Only where both exist.">
                Difference
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const g = gap(r);
              const diff = g === null ? null : Math.round(g * 100);
              const n = numberOf(r.key);
              return (
                <tr key={r.key} className={n ? "is-focus" : undefined}>
                  <th scope="row">
                    <span className="mt-name">
                      {n ? <span className={`fmk s${r.slot}`}>{n}</span> : <i className={`mk-dot s${r.slot}`} aria-hidden="true" />}
                      <span className="tg-name" title={r.label}>
                        {displayName(r.label).name}
                      </span>
                    </span>
                  </th>
                  <td className="num" data-label="Asked">
                    <Cells entries={r.asked} />
                  </td>
                  <td className="num" data-label="Acting">
                    <Cells entries={r.acting} />
                  </td>
                  <td data-label="Difference" className={`num diff ${diff === null ? "none" : diff > 0 ? "up" : diff < 0 ? "down" : ""}`}>
                    {diff === null ? <span className="muted">—</span> : `${diff > 0 ? "+" : ""}${diff} pts`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length > LIMIT ? (
        <button type="button" className="ghost show-all" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${list.length} models`}
        </button>
      ) : null}
    </>
  );
}

function Cells({ entries }: { entries: ClientSummary[] }) {
  if (entries.length === 0) return <span className="muted">not run</span>;
  return (
    <div className="tg-cells">
      {entries.map((m) => {
        const rate = m.overall.actRate;
        const ch = displayName(m.run.label).channel;
        return (
          <Link key={m.run.id} href={`/results/${encodeURIComponent(m.run.id)}`} className="tg-cell">
            <span className="tg-top">
              <span className="bar" aria-hidden="true">
                <i style={{ width: `${Math.round((rate ?? 0) * 100)}%` }} />
              </span>
              <span className="tg-rate">{rate === null ? "n/a" : `${Math.round(rate * 100)}%`}</span>
            </span>
            <span className="tg-sub">
              n={m.overall.nValid}
              {ch ? ` · ${shortChannel(ch)}` : ""}
              {m.run.selfReported && m.run.review !== "approved" ? " · unreviewed" : ""}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

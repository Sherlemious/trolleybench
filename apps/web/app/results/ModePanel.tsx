"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ModeGroup } from "../../lib/analysis";
import type { ModelMeta } from "../../lib/family";
import Compare, { type CompareView } from "../Compare";

export interface PanelMeta extends ModelMeta {
  /** "via API", "via MCP · agent": worked out on the server, where the rule lives. */
  via: string;
}

type Sort = "act-desc" | "act-asc" | "flip" | "answers" | "name";
/** A column header picks the sort that column offers; clicking again reverses it where it can. */
const HEADER_SORT: Record<string, [Sort, Sort?]> = {
  model: ["name"],
  act: ["act-desc", "act-asc"],
  flip: ["flip"],
  answers: ["answers"],
};
type Facet = "company" | "family" | "review" | "source";

const VIEWS: Array<{ id: CompareView; label: string; hint: string }> = [
  { id: "rows", label: "Rows", hint: "one row per model, with intervals" },
  { id: "overlay", label: "One line", hint: "everyone on a single shared axis per scenario" },
  { id: "table", label: "Table", hint: "the same numbers as a grid" },
];

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: "act-desc", label: "Acts most" },
  { id: "act-asc", label: "Acts least" },
  { id: "flip", label: "Most order-sensitive" },
  { id: "answers", label: "Most answers" },
  { id: "name", label: "Name" },
];

function sourceOf(origin: string): string {
  return origin === "api" ? "API" : origin === "mcp" ? "MCP" : origin === "browser" ? "Browser" : "Command line";
}

/** Add or remove one value from a multi-select; an empty set means "everything". */
function toggle(set: Set<string>, v: string): Set<string> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

function count(values: string[]): Array<{ value: string; count: number }> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function Chips({
  name,
  options,
  picked,
  onPick,
}: {
  name: string;
  options: Array<{ value: string; count: number }>;
  picked: Set<string>;
  onPick: (v: string) => void;
}) {
  // A single option cannot narrow anything, unless it is already picked and needs undoing.
  if (options.length < 2 && picked.size === 0) return null;
  const shown = [...options];
  for (const p of picked) if (!shown.some((o) => o.value === p)) shown.push({ value: p, count: 0 });
  return (
    <div className="f-row" role="group" aria-label={name}>
      <span className="f-name">{name}</span>
      {shown.map((o) => (
        <button key={o.value} type="button" className="fchip" aria-pressed={picked.has(o.value)} onClick={() => onPick(o.value)}>
          {o.value}
          <span className="c">{o.count}</span>
        </button>
      ))}
    </div>
  );
}

/** A dropdown that matches the chips: a button, a small popover, a tick on the current choice. */
function Menu<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const current = options.find((o) => o.id === value)?.label ?? "";
  return (
    <div className="menu" ref={root}>
      <button type="button" className="fchip menu-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="menu-label">{label}</span>
        {current}
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <ul className="menu-pop" role="listbox" aria-label={label}>
          {options.map((o) => (
            <li key={o.id} role="option" aria-selected={o.id === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
              >
                <span className="tick">{o.id === value ? "✓" : ""}</span>
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function ModePanel({
  group,
  title,
  body,
  meta,
  caveat,
}: {
  group: ModeGroup;
  title: string;
  body: string;
  meta: Record<string, PanelMeta>;
  /** The long caveat paragraph: shown once on the page, then referred back to. */
  caveat: boolean;
}) {
  const [picked, setPicked] = useState<Record<Facet, Set<string>>>({
    company: new Set(),
    family: new Set(),
    review: new Set(),
    source: new Set(),
  });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("act-desc");
  const [view, setView] = useState<CompareView>("rows");
  const [open, setOpen] = useState(false); // filters, on narrow screens

  const rows = useMemo(
    () =>
      group.models.map((m) => ({
        m,
        company: meta[m.run.id]?.company ?? "Other",
        family: meta[m.run.id]?.family ?? "Other",
        review: m.run.review === "approved" ? "Reviewed" : "Unreviewed",
        source: sourceOf(m.run.origin),
      })),
    [group, meta],
  );
  type Row = (typeof rows)[number];

  // A facet's options are counted over what the *other* filters leave, so no chip leads to an empty page.
  const matches = (r: Row, skip?: Facet) =>
    (["company", "family", "review", "source"] as const).every((f) => f === skip || picked[f].size === 0 || picked[f].has(r[f])) &&
    (query.trim() === "" || r.m.run.label.toLowerCase().includes(query.trim().toLowerCase()));

  const visible = rows.filter((r) => matches(r));
  const act = (r: Row) => r.m.overall.actRate ?? -1;
  visible.sort((a, b) =>
    sort === "act-desc"
      ? act(b) - act(a)
      : sort === "act-asc"
        ? act(a) - act(b)
        : sort === "flip"
          ? (b.m.flipRate ?? -1) - (a.m.flipRate ?? -1)
          : sort === "answers"
            ? b.m.overall.total - a.m.overall.total
            : a.m.run.label.localeCompare(b.m.run.label),
  );

  const sortBy = (col: string) => {
    const [a, b] = HEADER_SORT[col];
    setSort(sort === a && b ? b : a);
  };
  const arrow = (col: string) => (HEADER_SORT[col].includes(sort) ? (sort === "act-asc" ? " ↑" : " ↓") : "");
  const acts = visible
    .map((r) => r.m.overall.actRate)
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);
  const totalAnswers = visible.reduce((n, r) => n + r.m.overall.total, 0);
  const median = acts.length ? acts[Math.floor(acts.length / 2)] : null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const chosen = (["company", "family", "review", "source"] as const).flatMap((f) => [...picked[f]].map((v) => ({ f, v })));

  const ids = new Set(visible.map((r) => r.m.run.id));
  const comparisons = group.comparisons.map((c) => ({ ...c, models: c.models.filter((m) => ids.has(m.run.id)) }));
  const active = picked.company.size + picked.family.size + picked.review.size + picked.source.size + (query.trim() ? 1 : 0);
  const pick = (f: Facet) => (v: string) => setPicked({ ...picked, [f]: toggle(picked[f], v) });
  const facet = (f: Facet) => count(rows.filter((r) => matches(r, f)).map((r) => r[f]));
  const reset = () => {
    setPicked({ company: new Set(), family: new Set(), review: new Set(), source: new Set() });
    setQuery("");
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <span className="hint">
          elicitation mode <code>{group.mode}</code>
        </span>
      </div>
      <div className="panel-body">
        <p className="intro">{body}</p>

        {visible.length > 0 ? (
          <dl className="stats">
            <div>
              <dt>Models</dt>
              <dd>{visible.length}</dd>
            </div>
            <div>
              <dt>Answers</dt>
              <dd>{totalAnswers.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Median acts</dt>
              <dd>{median === null ? "n/a" : pct(median)}</dd>
            </div>
            <div>
              <dt>Range</dt>
              <dd>{acts.length > 1 ? `${pct(acts[0])} – ${pct(acts[acts.length - 1])}` : "n/a"}</dd>
            </div>
          </dl>
        ) : null}

        <div className="filters">
          <div className="f-bar">
            <input
              type="search"
              placeholder="Find a model"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter by model name"
            />
            {rows.length > 1 ? (
              <button type="button" className="fchip f-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
                Filters
                {active > 0 ? <span className="c">{active}</span> : null}
              </button>
            ) : null}
            <Menu label="Sort" value={sort} options={SORTS} onChange={setSort} />
            <div className="seg" role="group" aria-label="View">
              {VIEWS.map((v) => (
                <button key={v.id} type="button" aria-pressed={view === v.id} title={v.hint} onClick={() => setView(v.id)}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          {rows.length > 1 ? (
            <div className="f-body" data-open={open}>
              <Chips name="Company" options={facet("company")} picked={picked.company} onPick={pick("company")} />
              <Chips name="Family" options={facet("family")} picked={picked.family} onPick={pick("family")} />
              <Chips name="Review" options={facet("review")} picked={picked.review} onPick={pick("review")} />
              <Chips name="Source" options={facet("source")} picked={picked.source} onPick={pick("source")} />
            </div>
          ) : null}
          {active > 0 ? (
            <div className="f-active" aria-live="polite">
              <span className="f-count">
                {visible.length} of {rows.length} models
              </span>
              {chosen.map(({ f, v }) => (
                <button key={f + v} type="button" className="pill" onClick={() => pick(f)(v)} aria-label={`Remove filter ${v}`}>
                  {v} <span aria-hidden="true">×</span>
                </button>
              ))}
              <button type="button" className="f-reset" onClick={reset}>
                clear all
              </button>
            </div>
          ) : null}
        </div>

        {visible.length === 0 ? (
          <p className="empty-filter">No model matches these filters.</p>
        ) : (
          <div className="model-table-wrap">
            <table className="model-table">
              <thead>
                <tr>
                  <th scope="col" aria-sort={sort === "name" ? "ascending" : "none"}>
                    <button type="button" className="th-btn" onClick={() => sortBy("model")}>
                      model{arrow("model")}
                    </button>
                  </th>
                  <th scope="col" aria-sort={sort === "act-desc" ? "descending" : sort === "act-asc" ? "ascending" : "none"}>
                    <button type="button" className="th-btn" onClick={() => sortBy("act")}>
                      chose to act{arrow("act")}
                    </button>
                  </th>
                  <th scope="col">refused</th>
                  <th scope="col" title="Share of paired cells whose answer changed when the options swapped places. 50% is a coin.">
                    <button type="button" className="th-btn" onClick={() => sortBy("flip")}>
                      flipped with order{arrow("flip")}
                    </button>
                  </th>
                  <th scope="col">
                    <button type="button" className="th-btn" onClick={() => sortBy("answers")}>
                      answers{arrow("answers")}
                    </button>
                  </th>
                  <th scope="col" title="Separate runs of this model by the same submitter, merged. Each is resampled as a unit.">
                    sessions
                  </th>
                  <th scope="col">submitted by</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ m }) => {
                  const flip = m.flipRate;
                  return (
                    <tr key={m.run.id}>
                      <th scope="row">
                        <Link href={`/results/${encodeURIComponent(m.run.id)}`} className={`model-link s${m.run.slot}`}>
                          <i className="mk-dot" aria-hidden="true" />
                          {m.run.label}
                        </Link>
                      </th>
                      <td className="num act-cell">
                        {m.overall.actRate === null ? (
                          "n/a"
                        ) : (
                          <>
                            <span className="bar" aria-hidden="true">
                              <i style={{ width: `${Math.round(m.overall.actRate * 100)}%` }} />
                            </span>
                            {Math.round(m.overall.actRate * 100)}%
                          </>
                        )}
                      </td>
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
                            {m.run.review === "approved" ? "reviewed" : "unreviewed"} · {meta[m.run.id]?.via ?? ""}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {caveat ? (
          <p className="foot-note">
            A flip rate near 50% means answers track where an option sits rather than what it says; treat that model&rsquo;s other
            numbers as artefacts. Repeat sessions of a model are merged only within one submitter, so a rejected run never touches
            anyone else&rsquo;s results. Self-reported runs were submitted through the site, which records what the model answered
            but cannot verify which model answered; unreviewed ones have not been checked yet.
          </p>
        ) : (
          <p className="foot-note">The caveats above apply here too.</p>
        )}

        {visible.length > 0 ? (
          <>
            <h3 className="sub-h">Scenario by scenario</h3>
            <Compare comparisons={comparisons} view={view} />
          </>
        ) : null}
      </div>
    </section>
  );
}

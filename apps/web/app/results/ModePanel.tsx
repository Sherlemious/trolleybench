"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ModeGroup } from "../../lib/analysis";
import { displayName, modelKey, shortChannel } from "../../lib/display";
import type { ModelMeta } from "../../lib/family";
import { useFocus } from "../focus";

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
const FACETS: Array<{ id: Facet; label: string }> = [
  { id: "company", label: "Company" },
  { id: "family", label: "Family" },
  { id: "source", label: "Source" },
  { id: "review", label: "Review" },
];

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: "act-desc", label: "Acts most" },
  { id: "act-asc", label: "Acts least" },
  { id: "flip", label: "Most order-sensitive" },
  { id: "answers", label: "Most answers" },
  { id: "name", label: "Name" },
];

/** Rows shown before "Show all": enough to scan, short enough with 200 models. */
const PAGE = 25;

function sourceOf(origin: string): string {
  return origin === "api"
    ? "API"
    : origin === "mcp"
      ? "MCP"
      : origin === "browser"
        ? "Browser"
        : origin === "agent"
          ? "Agent CLI"
          : "Command line";
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

function useDismiss(open: boolean, close: () => void) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, close]);
  return root;
}

/** A multi-select dropdown: a button with an active count, a popover of checkable values. */
function FacetMenu({
  label,
  options,
  picked,
  onPick,
}: {
  label: string;
  options: Array<{ value: string; count: number }>;
  picked: Set<string>;
  onPick: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useDismiss(open, () => setOpen(false));
  // A single option cannot narrow anything, unless it is already picked and needs undoing.
  if (options.length < 2 && picked.size === 0) return null;
  const shown = [...options];
  for (const p of picked) if (!shown.some((o) => o.value === p)) shown.push({ value: p, count: 0 });
  return (
    <div className="menu" ref={root}>
      <button type="button" className="fchip menu-btn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
        {picked.size > 0 ? <span className="badge-n">{picked.size}</span> : null}
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <ul className="menu-pop" aria-label={label}>
          {shown.map((o) => (
            <li key={o.value}>
              <button type="button" role="menuitemcheckbox" aria-checked={picked.has(o.value)} onClick={() => onPick(o.value)}>
                <span className="check" aria-hidden="true">
                  {picked.has(o.value) ? "✓" : ""}
                </span>
                <span className="ml">{o.value}</span>
                <span className="c">{o.count}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A single-choice dropdown: a button, a small popover, a tick on the current choice. */
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
  const root = useDismiss(open, () => setOpen(false));
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
                <span className="check">{o.id === value ? "✓" : ""}</span>
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Every model in one elicitation mode, as a table built for hundreds of rows: search, a
 * row of dropdown filters, sortable columns, and the first page shown with the rest one
 * click away. The scenario-by-scenario charts live above it, shared across modes.
 */
export default function ModePanel({
  group,
  meta,
}: {
  group: ModeGroup;
  meta: Record<string, PanelMeta>;
}) {
  const { numberOf, toggle: toggleFocus } = useFocus();
  const empty = (): Record<Facet, Set<string>> => ({ company: new Set(), family: new Set(), review: new Set(), source: new Set() });
  const [picked, setPicked] = useState<Record<Facet, Set<string>>>(empty);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("act-desc");
  const [all, setAll] = useState(false);

  const rows = useMemo(
    () =>
      group.models.map((m) => ({
        m,
        company: meta[m.run.id]?.company ?? "Other",
        family: meta[m.run.id]?.family ?? "Other",
        review: m.run.review === "approved" ? "Reviewed" : "Unreviewed",
        source: sourceOf(m.run.origin),
        name: displayName(m.run.label),
      })),
    [group, meta],
  );
  type Row = (typeof rows)[number];

  // A facet's options are counted over what the *other* filters leave, so no choice leads to an empty page.
  const q = query.trim().toLowerCase();
  const matches = (r: Row, skip?: Facet) =>
    FACETS.every(({ id: f }) => f === skip || picked[f].size === 0 || picked[f].has(r[f])) &&
    (q === "" || r.m.run.label.toLowerCase().includes(q) || r.name.name.toLowerCase().includes(q));

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
            : a.name.name.localeCompare(b.name.name),
  );
  const shown = all ? visible : visible.slice(0, PAGE);

  const sortBy = (col: string) => {
    const [a, b] = HEADER_SORT[col]!;
    setSort(sort === a && b ? b : a);
  };
  const arrow = (col: string) => (HEADER_SORT[col]!.includes(sort) ? (sort === "act-asc" ? " ↑" : " ↓") : "");
  const chosen = FACETS.flatMap(({ id: f }) => [...picked[f]].map((v) => ({ f, v })));
  const active = chosen.length + (q ? 1 : 0);
  const pick = (f: Facet) => (v: string) => setPicked({ ...picked, [f]: toggle(picked[f], v) });
  const facet = (f: Facet) => count(rows.filter((r) => matches(r, f)).map((r) => r[f]));
  const reset = () => {
    setPicked(empty());
    setQuery("");
  };

  return (
    <div className="mode-table">
      <div className="filters">
        <div className="f-bar">
          <input type="search" placeholder={`Search ${rows.length} model${rows.length === 1 ? "" : "s"}`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search models by name" />
          {rows.length > 1 ? FACETS.map(({ id, label }) => <FacetMenu key={id} label={label} options={facet(id)} picked={picked[id]} onPick={pick(id)} />) : null}
          <Menu label="Sort" value={sort} options={SORTS} onChange={setSort} />
        </div>
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
              Clear all
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
                    Model{arrow("model")}
                  </button>
                </th>
                <th scope="col" aria-sort={sort === "act-desc" ? "descending" : sort === "act-asc" ? "ascending" : "none"}>
                  <button type="button" className="th-btn" onClick={() => sortBy("act")}>
                    Chose to act{arrow("act")}
                  </button>
                </th>
                <th scope="col" className="num">
                  Refused
                </th>
                <th scope="col" className="num" title="Share of paired cells whose answer changed when the options swapped places. 50% is a coin.">
                  <button type="button" className="th-btn" onClick={() => sortBy("flip")}>
                    Flipped with order{arrow("flip")}
                  </button>
                </th>
                <th scope="col" className="num">
                  <button type="button" className="th-btn" onClick={() => sortBy("answers")}>
                    Answers{arrow("answers")}
                  </button>
                </th>
                <th scope="col">Submitted by</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ m, name }) => {
                const flip = m.flipRate;
                const key = modelKey(m.run.label);
                const n = numberOf(key);
                return (
                  <tr key={m.run.id} className={n ? "is-focus" : undefined}>
                    <th scope="row">
                      <span className="mt-name">
                        <button
                          type="button"
                          className={`mt-pin s${m.run.slot}${n ? " on" : ""}`}
                          onClick={() => toggleFocus(key)}
                          aria-pressed={n > 0}
                          aria-label={n ? `Stop highlighting ${name.name}` : `Highlight ${name.name} on the charts`}
                          title={n ? "Highlighted on the charts" : "Highlight on the charts"}
                        >
                          {n || ""}
                        </button>
                        <Link href={`/results/${encodeURIComponent(m.run.id)}`} className="model-link" title={m.run.label}>
                          {name.name}
                        </Link>
                        {name.channel ? <span className="tag">{shortChannel(name.channel)}</span> : null}
                      </span>
                    </th>
                    <td className="act-cell">
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
                    <td className="num" title={`${m.run.sessionIds.length} session${m.run.sessionIds.length === 1 ? "" : "s"}`}>
                      {m.overall.total}
                    </td>
                    <td className="mt-sub">
                      <span className="submitter">{m.run.submitter}</span>
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
      {visible.length > PAGE ? (
        <button type="button" className="ghost show-all" onClick={() => setAll(!all)}>
          {all ? `Show the first ${PAGE}` : `Show all ${visible.length} models`}
        </button>
      ) : null}
    </div>
  );
}

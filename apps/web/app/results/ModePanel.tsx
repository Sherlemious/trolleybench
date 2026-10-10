"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ModeGroup } from "../../lib/analysis";
import type { ModelMeta } from "../../lib/family";
import Compare, { type CompareView } from "../Compare";

export interface PanelMeta extends ModelMeta {
  /** "via API", "via MCP · agent": worked out on the server, where the rule lives. */
  via: string;
}

type Sort = "act-desc" | "act-asc" | "flip" | "answers" | "name";
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

        <div className="filters">
          {rows.length > 1 ? (
            <>
              <div className="f-row">
                <span className="f-name">Find</span>
                <input
                  type="search"
                  placeholder="model name"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Filter by model name"
                />
                <label className="f-name" htmlFor={`sort-${group.mode}`}>
                  Sort
                </label>
                <select id={`sort-${group.mode}`} value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="fchip">
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <Chips name="Company" options={facet("company")} picked={picked.company} onPick={pick("company")} />
              <Chips name="Family" options={facet("family")} picked={picked.family} onPick={pick("family")} />
              <Chips name="Review" options={facet("review")} picked={picked.review} onPick={pick("review")} />
              <Chips name="Source" options={facet("source")} picked={picked.source} onPick={pick("source")} />
            </>
          ) : null}
          <div className="f-row">
            <span className="f-name">View</span>
            {VIEWS.map((v) => (
              <button key={v.id} type="button" className="fchip" aria-pressed={view === v.id} title={v.hint} onClick={() => setView(v.id)}>
                {v.label}
              </button>
            ))}
            {active > 0 ? (
              <>
                <span className="f-count">
                  {visible.length} of {rows.length} models
                </span>
                <button type="button" className="f-reset" onClick={reset}>
                  clear filters
                </button>
              </>
            ) : null}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="empty-filter">No model matches these filters.</p>
        ) : (
          <div className="model-table-wrap">
            <table className="model-table">
              <thead>
                <tr>
                  <th scope="col">model</th>
                  <th scope="col">chose to act</th>
                  <th scope="col">refused</th>
                  <th scope="col" title="Share of paired cells whose answer changed when the options swapped places. 50% is a coin.">
                    flipped with order
                  </th>
                  <th scope="col">answers</th>
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
                      <td className="num">{m.overall.actRate === null ? "n/a" : `${Math.round(m.overall.actRate * 100)}%`}</td>
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

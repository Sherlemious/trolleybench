"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ModeGroup, RunSummary, SayDoExample, SayDoModel, ScenarioGuide } from "../../lib/analysis";
import { MODE_LABEL, baseLabel, displayName, modelKey, shortChannel } from "../../lib/display";
import { MEASURE_LABEL } from "../../lib/measure";
import { FocusProvider, useFocus } from "../focus";
import ModelPicker, { type PickerModel } from "../ModelPicker";
import ScenarioStrip, { StripLegend } from "../ScenarioStrip";
import { companiesIn, stripsFor, widestLane } from "../../lib/strips";
import ModePanel, { type PanelMeta } from "./ModePanel";
import SayDo, { WhatTheModelSees } from "./SayDo";
import SayDoScatter, { type ScatterPoint } from "./SayDoScatter";

export interface TabSection {
  pack: string;
  /** Short tab label. */
  tab: string;
  title: string;
  body: string;
  modes: Record<string, { title: string; body: string }>;
  groups: ModeGroup[];
  sayDo: SayDoModel[];
  scenarios: ScenarioGuide[];
  sayDoExample: SayDoExample | null;
}


/**
 * The results, one pack at a time.
 *
 * Packs are tabs because their act rates measure different dilemmas and must never sit
 * in one table. Within a pack the page reads top-down: people beside models, scenario by
 * scenario; then each model asked against the same model acting; then every model in a
 * table. Asked and acting stay separate lanes and separate columns everywhere - they are
 * never averaged, so invariant 1 holds on screen as it does in the code.
 *
 * Every chart draws all models as a distribution, so the page holds 5 models or 500.
 * The reader picks models to highlight once, and every chart and table follows.
 *
 * The pack lives in the URL hash (`#ai-agent`), the highlighted models in `?focus=`.
 */
export default function ResultsTabs({ sections, meta }: { sections: TabSection[]; meta: Record<string, PanelMeta> }) {
  const [pack, setPack] = useState(sections[0]?.pack ?? "");

  useEffect(() => {
    const read = () => {
      const p = window.location.hash.slice(1).split("/")[0];
      if (p && sections.some((s) => s.pack === p)) setPack(p);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [sections]);

  const go = (p: string) => {
    setPack(p);
    history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}#${p}`);
  };

  const section = sections.find((s) => s.pack === pack) ?? sections[0];
  const known = useMemo(() => [...new Set(sections.flatMap((s) => s.groups.flatMap((g) => g.models.map((m) => modelKey(m.run.label)))))], [sections]);
  if (!section) return null;

  return (
    <FocusProvider known={known}>
      <div className="rtabs">
        {sections.length > 1 ? (
          <div className="rtabs-packs" role="tablist" aria-label="Scenario pack">
            {sections.map((s) => {
              const models = new Set(s.groups.flatMap((g) => g.models.map((m) => modelKey(m.run.label))));
              return (
                <button key={s.pack} type="button" role="tab" aria-selected={s.pack === section.pack} className="rtab" onClick={() => go(s.pack)}>
                  <span className="rtab-name">{s.tab}</span>
                  <span className="rtab-sub">
                    {models.size} model{models.size === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <header className="rtabs-head">
          <h2>{section.title}</h2>
          <p>{section.body}</p>
        </header>

        {pickerModels(section, meta).length > 1 ? (
          <div className="focus-bar">
            <ModelPicker models={pickerModels(section, meta)} />
          </div>
        ) : null}

        <Guide scenarios={section.scenarios} />
        {section.sayDoExample ? <ExampleFocused example={section.sayDoExample} /> : null}
        <PeopleAndModels section={section} />
        <AskedVsActing section={section} />
        <SayDoFocused models={section.sayDo} scenarios={section.scenarios} example={section.sayDoExample} />
        <EveryModel section={section} meta={meta} />
      </div>
    </FocusProvider>
  );
}

function pickerModels(section: TabSection, meta: Record<string, PanelMeta>): PickerModel[] {
  const out = new Map<string, PickerModel>();
  for (const g of section.groups)
    for (const m of g.models) {
      const key = modelKey(m.run.label);
      if (!out.has(key)) out.set(key, { key, label: baseLabel(m.run.label), company: meta[m.run.id]?.company ?? "Other", slot: m.run.slot });
    }
  return [...out.values()];
}

/**
 * What each dilemma is, in a sentence, before any number about it. Shown only for a
 * pack whose templates carry summaries; the canon's cases are famous enough to name.
 */
function Guide({ scenarios }: { scenarios: ScenarioGuide[] }) {
  const described = scenarios.filter((s) => s.summary);
  if (described.length === 0) return null;
  return (
    <details className="guide" open>
      <summary>
        <span className="guide-title">The dilemmas</span>
        <span className="guide-hint">{described.length} scenarios · what each one asks, and what acting means in it</span>
      </summary>
      <ol className="guide-grid">
        {scenarios.map((s, i) =>
          s.summary ? (
            <li key={s.id} className="guide-card" id={`scenario-${s.id}`}>
              <span className="guide-no" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3>{s.title}</h3>
              <p>{s.summary}</p>
            </li>
          ) : null,
        )}
      </ol>
    </details>
  );
}

/** People beside models, one compact strip per scenario. Only for packs with human baselines. */
function PeopleAndModels({ section }: { section: TabSection }) {
  const strips = stripsFor(section.groups);
  if (strips.length === 0) return null;
  const companies = companiesIn(section.groups);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>People and models, scenario by scenario</h2>
        <span className="hint">
          <Link href="/sources">Where the human numbers come from</Link>
        </span>
      </div>
      <div className="panel-body">
        <p className="intro">
          The shaded band spans what people said across published studies. Each dot is a model; where models and people part
          ways is the finding. To see the exact prompt a model receives for any scenario,{" "}
          <Link href="/workbench">open it in the Workbench</Link>.
        </p>
        <StripLegend companies={companies} widest={widestLane(strips)} />
        {strips.map((s) => {
          const humans = s.humans
            .filter((b) => b.value !== null)
            .map((b) => ({ id: b.id, label: b.short, value: b.value as number, note: `${MEASURE_LABEL[b.measure]}${b.n ? `, n=${b.n.toLocaleString("en")}` : ""}`, href: b.href }));
          const findings = s.humans.filter((b) => b.finding);
          return (
            <div key={s.id} className="strip-block">
              <ScenarioStrip title={s.title} sub={s.cells} humans={humans} lanes={s.lanes} />
              {findings.map((b) => (
                <p className="strip-finding" key={b.id}>
                  <strong>{b.href ? <a href={b.href}>{b.short}</a> : b.short}:</strong> {b.finding}
                </p>
              ))}
            </div>
          );
        })}
        <details className="method-notes">
          <summary>How to read this</summary>
          <p>
            Studies worded their questions differently from each other and from us &mdash; permissibility, what someone{" "}
            <em>should</em> do &mdash; so read a gap as direction, not distance. The spread between the studies is part of the
            finding. A model&rsquo;s dot is the share of its valid answers that chose to act on the cells named under each
            scenario; refusals are reported in its run, never counted as either choice.
          </p>
          <p>
            Highlight a model to see its 95% Wilson interval. Dashed intervals have fewer than 10 answers: read the interval, not
            the dot. Past 60 models a lane switches from dots to a stacked histogram in 5-point bins; hover a bar to see who is in
            it.
          </p>
        </details>
      </div>
    </section>
  );
}

/** Each model asked against the same model acting: a scatter, then the pairs as a table. */
function AskedVsActing({ section }: { section: TabSection }) {
  const asked = section.groups.find((g) => g.mode === "prompt");
  const acting = section.groups.find((g) => g.mode === "mcp_tool");
  if (!asked || !acting) return null;

  const rows = new Map<string, { label: string; asked: RunSummary[]; acting: RunSummary[] }>();
  for (const g of [asked, acting])
    for (const m of g.models) {
      const key = modelKey(m.run.label);
      const row = rows.get(key) ?? { label: baseLabel(m.run.label), asked: [], acting: [] };
      (g.mode === "mcp_tool" ? row.acting : row.asked).push(m);
      rows.set(key, row);
    }
  const points: ScatterPoint[] = [];
  for (const [key, r] of rows) {
    const a = r.asked[0];
    const d = r.acting[0];
    if (a?.overall.actRate == null || d?.overall.actRate == null) continue;
    points.push({ key, label: r.label, slot: a.run.slot, x: a.overall.actRate, y: d.overall.actRate, nx: a.overall.nValid, ny: d.overall.nValid, askedId: a.run.id, actingId: d.run.id });
  }
  if (points.length === 0) return null;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Asked versus acting</h2>
        <span className="hint">
          {points.length} of {rows.size} models measured both ways
        </span>
      </div>
      <div className="panel-body">
        <p className="intro">
          <strong>Asked:</strong> {section.modes["prompt"]?.body ?? "the model chose an option."} <strong>Acting:</strong>{" "}
          {section.modes["mcp_tool"]?.body ?? "the model acted through tools."}
        </p>
        <SayDoScatter points={points} notBoth={rows.size - points.length} />
        <Together rows={[...rows.entries()]} />
        <details className="method-notes">
          <summary>How to read this</summary>
          <p>
            The two are separate measurements, so they sit side by side and are never averaged. The difference compares two
            separate runs of the same model, often through different channels and on different sessions; it is a pointer to look
            closer, not an effect estimate.
            {section.sayDo.length > 0 ? " The say-versus-do panel below makes the comparison properly: cell by cell, on identical dilemmas." : ""}
          </p>
        </details>
      </div>
    </section>
  );
}

/** The scatter's pairs as rows, highlighted models first, the rest one click away. */
function Together({ rows }: { rows: Array<[string, { label: string; asked: RunSummary[]; acting: RunSummary[] }]> }) {
  const { numberOf } = useFocus();
  const [all, setAll] = useState(false);
  const gap = (r: { asked: RunSummary[]; acting: RunSummary[] }) => {
    const a = r.asked[0]?.overall.actRate;
    const d = r.acting[0]?.overall.actRate;
    return a != null && d != null ? d - a : null;
  };
  // Highlighted first; then the biggest gaps either way, since that is what this table is for.
  const list = rows
    .slice()
    .sort(([ka, a], [kb, b]) => {
      const fa = numberOf(ka) || 99;
      const fb = numberOf(kb) || 99;
      if (fa !== fb) return fa - fb;
      const ga = gap(a);
      const gb = gap(b);
      if ((ga === null) !== (gb === null)) return ga === null ? 1 : -1;
      return Math.abs(gb ?? 0) - Math.abs(ga ?? 0) || a.label.localeCompare(b.label);
    });
  const LIMIT = 8;
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
            {shown.map(([key, r]) => {
              const g = gap(r);
              const diff = g === null ? null : Math.round(g * 100);
              const n = numberOf(key);
              const slot = (r.asked[0] ?? r.acting[0])?.run.slot ?? 9;
              return (
                <tr key={key} className={n ? "is-focus" : undefined}>
                  <th scope="row">
                    <span className="mt-name">
                      {n ? <span className={`fmk s${slot}`}>{n}</span> : <i className={`mk-dot s${slot}`} aria-hidden="true" />}
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

function Cells({ entries }: { entries: RunSummary[] }) {
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

/**
 * Say versus do, cell by cell. Its table has three columns per model, so it shows the
 * highlighted models - or the first three - rather than every model at once.
 */
function SayDoFocused({ models, scenarios, example }: { models: SayDoModel[]; scenarios: ScenarioGuide[]; example: SayDoExample | null }) {
  const { focus } = useFocus();
  if (models.length === 0) return null;
  const picked = focus.length ? models.filter((m) => focus.includes(modelKey(m.label))) : [];
  const shown = picked.length ? picked : models.slice(0, 3);
  const note =
    models.length > shown.length
      ? picked.length
        ? `Showing the ${shown.length} highlighted of ${models.length} models measured both ways.`
        : `Showing ${shown.length} of ${models.length} models measured both ways. Highlight models above to compare others.`
      : null;
  return <SayDo models={shown} scenarios={scenarios} example={example} note={note} />;
}

function ExampleFocused({ example }: { example: SayDoExample }) {
  const { focus } = useFocus();
  return <WhatTheModelSees example={example} focus={focus} />;
}

/** Every model, one mode at a time: the full, filterable table. */
function EveryModel({ section, meta }: { section: TabSection; meta: Record<string, PanelMeta> }) {
  const [mode, setMode] = useState(section.groups[0]?.mode ?? "prompt");
  const group = section.groups.find((g) => g.mode === mode) ?? section.groups[0];
  if (!group) return null;
  const copy = section.modes[group.mode];
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Every model</h2>
        {section.groups.length > 1 ? (
          <div className="seg" role="group" aria-label="Mode">
            {section.groups.map((g) => (
              <button key={g.mode} type="button" aria-pressed={g.mode === group.mode} onClick={() => setMode(g.mode)}>
                {MODE_LABEL[g.mode] ?? g.mode} · {g.models.length}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="panel-body">
        {copy ? <p className="intro">{copy.body}</p> : null}
        <ModePanel key={group.mode} group={group} meta={meta} />
        <details className="method-notes">
          <summary>How to read this</summary>
          <p>
            A flip rate near 50% means answers track where an option sits rather than what it says; treat that model&rsquo;s
            other numbers as artefacts. Repeat sessions of a model are merged only within one submitter, so a rejected run never
            touches anyone else&rsquo;s results. Self-reported runs were submitted through the site, which records what the
            model answered but cannot verify which model answered; unreviewed ones have not been checked yet.
          </p>
        </details>
      </div>
    </section>
  );
}

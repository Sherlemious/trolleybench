"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import type { SayDoExample, SayDoModel, ScenarioGuide } from "../../lib/analysis";
import { displayName } from "../../lib/display";

function numberOf(scenarios: ScenarioGuide[], id: string): string {
  const i = scenarios.findIndex((s) => s.id === id);
  return i < 0 ? "" : String(i + 1).padStart(2, "0");
}

/** The "Acting means ..." sentence from a summary, so each row says what its numbers count. */
function actMeaning(scenarios: ScenarioGuide[], id: string): string {
  const summary = scenarios.find((s) => s.id === id)?.summary ?? "";
  return /Acting means ([^.]+)\./.exec(summary)?.[1] ?? "";
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`;
}

/** A heat cell: act share in the act colour, light to dark, the number always printed. */
function Cell({ n, d, title }: { n: number; d: number; title: string }) {
  if (d === 0) {
    return (
      <td className="na" title="no paired cells">
        <span className="v">n/a</span>
      </td>
    );
  }
  const v = n / d;
  return (
    <td style={{ ["--v" as string]: v.toFixed(3) }} className={v > 0.82 ? "dark" : undefined} title={title}>
      <span className="v">{pct(n, d)}</span>
      <span className="n">n={d}</span>
    </td>
  );
}

/** With tools minus asked, in points. Negative: it said it would act more often than it did. */
function Gap({ said, did, pairs }: { said: number; did: number; pairs: number }) {
  if (pairs === 0) return <td className="sd-gap">—</td>;
  const g = Math.round(((did - said) / pairs) * 100);
  return (
    <td className={`sd-gap ${g < 0 ? "neg" : g > 0 ? "pos" : ""}`} title="with tools, acted - asked, chose to act">
      {g === 0 ? "0" : `${g > 0 ? "+" : "−"}${Math.abs(g)}`}
      <span className="u">pts</span>
    </td>
  );
}

/**
 * Stated answer against action, for every model that took a pack both ways.
 *
 * Each pair is the same model on the same dilemma cell: once asked which option it
 * would choose, once handed tools and left to act. "Acted" counts only an action that
 * was carried out - calling the acting tool with a refusal in place of its content is
 * shown separately as hollow, not as acting.
 */
export default function SayDo({
  models,
  scenarios = [],
  example = null,
  note = null,
}: {
  models: SayDoModel[];
  scenarios?: ScenarioGuide[];
  example?: SayDoExample | null;
  /** Which models are shown, when not all of them are. */
  note?: string | null;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (models.length === 0) return null;
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const width = 1 + models.length * 3;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Say versus do</h2>
        <span className="hint">the same dilemma, asked and then acted on, by the same model</span>
      </div>
      <div className="panel-body">
        <p className="lede-sm">
          Every model met every dilemma twice, in separate sessions. <strong>Asked</strong>: it read the dilemma and chose an
          option by letter. <strong>With tools</strong>: it read the same dilemma, was given the options as tools, and had to
          use one; breaking a rule meant actually writing the chapter, the leak or the lie. The <strong>gap</strong> is how
          far its actions fell short of, or went beyond, what it said.{" "}
          {example ? <a href="#what-the-model-sees">Exactly what each side saw ↑</a> : null}
        </p>
        {note ? <p className="saydo-note">{note}</p> : null}
        <div className="saydo-summary">
          {models.map((m) => {
            const g = m.pairs ? Math.round(((m.didAct - m.saidAct) / m.pairs) * 100) : 0;
            return (
              <div key={m.label} className="saydo-card">
                <div className="who" title={m.label}>{displayName(m.label).name}</div>
                <div className="nums">
                  <span>
                    asked, chose to act <strong>{pct(m.saidAct, m.pairs)}</strong>
                  </span>
                  <span>
                    with tools, acted <strong>{pct(m.didAct, m.pairs)}</strong>
                  </span>
                  <span>
                    gap{" "}
                    <strong className={g < 0 ? "neg" : g > 0 ? "pos" : ""}>
                      {g === 0 ? "0" : `${g > 0 ? "+" : "−"}${Math.abs(g)}`} pts
                    </strong>
                  </span>
                </div>
                <div className="gap">
                  On {m.pairs} dilemmas: {m.saidButDidNot} times it said it would act and then did not; {m.didButDidNotSay}{" "}
                  times it said it would not and then did.
                  {m.hollow ? ` ${m.hollow} hollow: it called the acting tool but refused inside it.` : ""}
                </div>
                <div className="links">
                  <Link href={`/results/${encodeURIComponent(m.saidId)}`}>asked run</Link>
                  <Link href={`/results/${encodeURIComponent(m.didId)}`}>with-tools run</Link>
                </div>
              </div>
            );
          })}
        </div>

        <div className="heat-wrap">
          <table className="heat saydo">
            <thead>
              <tr>
                <th scope="col">dilemma</th>
                {models.map((m) => (
                  <th scope="colgroup" colSpan={3} key={m.label} title={m.label}>
                    {displayName(m.label).name}
                  </th>
                ))}
              </tr>
              <tr>
                <th scope="col" />
                {models.flatMap((m) => [
                  <th scope="col" key={`${m.label}-s`} className="sd-col">
                    asked
                    <span>chose to act</span>
                  </th>,
                  <th scope="col" key={`${m.label}-d`} className="sd-col">
                    with tools
                    <span>acted</span>
                  </th>,
                  <th scope="col" key={`${m.label}-g`} className="sd-col">
                    gap
                    <span>points</span>
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {models[0]!.templates.map((t) => (
                <Fragment key={t.templateId}>
                <tr className={open.has(t.templateId) ? "sd-open" : undefined}>
                  <th scope="row" title={scenarios.find((s) => s.id === t.templateId)?.summary ?? undefined}>
                    <a className="t sd-row" href={`#scenario-${t.templateId}`}>
                      {numberOf(scenarios, t.templateId) ? <span className="sd-no">{numberOf(scenarios, t.templateId)}</span> : null}
                      {t.title}
                    </a>
                    <span className="sd-act">{actMeaning(scenarios, t.templateId)}</span>
                    {t.factors.length > 0 ? (
                      <button
                        type="button"
                        className="sd-toggle"
                        aria-expanded={open.has(t.templateId)}
                        aria-controls={`sd-x-${t.templateId}`}
                        onClick={() => toggle(t.templateId)}
                      >
                        {open.has(t.templateId) ? "hide the design" : "show the design"}
                      </button>
                    ) : null}
                  </th>
                  {models.flatMap((m) => {
                    const row = m.templates.find((x) => x.templateId === t.templateId);
                    const pairs = row?.pairs ?? 0;
                    return [
                      <Cell
                        key={`${m.label}-s`}
                        n={row?.saidAct ?? 0}
                        d={pairs}
                        title={`${m.label}, ${t.title}: asked, chose to act in ${row?.saidAct ?? 0} of ${pairs}`}
                      />,
                      <Cell
                        key={`${m.label}-d`}
                        n={row?.didAct ?? 0}
                        d={pairs}
                        title={`${m.label}, ${t.title}: with tools, acted in ${row?.didAct ?? 0} of ${pairs}${row?.hollow ? `, ${row.hollow} hollow` : ""}`}
                      />,
                      <Gap key={`${m.label}-g`} said={row?.saidAct ?? 0} did={row?.didAct ?? 0} pairs={pairs} />,
                    ];
                  })}
                </tr>
                {open.has(t.templateId) ? (
                  <tr className="sd-expand" id={`sd-x-${t.templateId}`}>
                    <td colSpan={width}>
                      <Breakdown models={models} templateId={t.templateId} />
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>


        <p className="foot-note">
          Dilemmas are in pack order, never sorted by the gap. These runs were taken by coding-agent subagents through the
          trolley agent command: self-reported, with the agent&rsquo;s own system prompt and its memory of earlier dilemmas in
          its session as confounds an API run would not have.
        </p>
      </div>
    </section>
  );
}

/**
 * A scenario's design, opened up: how its cells are built, then each factor level by
 * level, every model's asked / with-tools / gap side by side. A level is a slice of
 * the same paired cells, so this shows where the overall gap comes from.
 */
function Breakdown({ models, templateId }: { models: SayDoModel[]; templateId: string }) {
  const first = models[0]!.templates.find((t) => t.templateId === templateId);
  if (!first) return null;
  return (
    <div className="sd-breakdown">
      <p className="sd-design">
        <span className="k">design</span>
        {first.design} <span className="eq">=</span> <strong>{first.pairs} cells</strong>, each asked once and acted on once
        by every model.
      </p>
      <div className="sd-factors">
        {first.factors.map((f) => (
          <div key={f.id} className="sd-factor">
            <h5 title={f.description ?? undefined}>
              by {f.name}
              {f.description ? <span>{f.description}</span> : null}
            </h5>
            <table className="sd-sub">
              <thead>
                <tr>
                  <th scope="col" />
                  {models.map((m) => (
                    <th scope="colgroup" colSpan={3} key={m.label}>
                      {displayName(m.label).name}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th scope="col" />
                  {models.flatMap((m) => [
                    <th scope="col" key={`${m.label}-s`}>asked</th>,
                    <th scope="col" key={`${m.label}-d`}>tools</th>,
                    <th scope="col" key={`${m.label}-g`}>gap</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {f.levels.map((l) => (
                  <tr key={l.id}>
                    <th scope="row">{l.label}</th>
                    {models.flatMap((m) => {
                      const lv = m.templates
                        .find((t) => t.templateId === templateId)
                        ?.factors.find((x) => x.id === f.id)
                        ?.levels.find((x) => x.id === l.id);
                      const n = lv?.pairs ?? 0;
                      return [
                        <Cell key={`${m.label}-s`} n={lv?.saidAct ?? 0} d={n} title={`${m.label}, ${l.label}: asked, chose to act in ${lv?.saidAct ?? 0} of ${n}`} />,
                        <Cell key={`${m.label}-d`} n={lv?.didAct ?? 0} d={n} title={`${m.label}, ${l.label}: with tools, acted in ${lv?.didAct ?? 0} of ${n}${lv?.hollow ? `, ${lv.hollow} hollow` : ""}`} />,
                        <Gap key={`${m.label}-g`} said={lv?.saidAct ?? 0} did={lv?.didAct ?? 0} pairs={n} />,
                      ];
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}


"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { modelKey } from "../../lib/display";
import type { PlayModel, PlayStep } from "../../lib/play";
import { deriveScene, sceneKey } from "../../lib/scene";
import Scene, { type SceneRun } from "../Scene";
import ScenarioStrip, { type StripLane } from "../ScenarioStrip";

const LETTERS = "AB";
const STORE = "tb.play.v1";

type Picks = Record<string, "act" | "omit">;

/**
 * Five dilemmas, one at a time. Answer, watch it play out, then see how people and the
 * models answered the same question. Answers are kept in this browser and nowhere else:
 * collecting them would need a consent flow this site does not have yet.
 */
export default function Play({ steps }: { steps: PlayStep[] }) {
  const [picks, setPicks] = useState<Picks>({});
  const [at, setAt] = useState(0);
  const [run, setRun] = useState<SceneRun | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) setPicks(JSON.parse(raw) as Picks);
    } catch {
      /* private mode or blocked storage: the tour works without it */
    }
  }, []);

  const save = useCallback((next: Picks) => {
    setPicks(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const finished = at >= steps.length;
  const step = steps[Math.min(at, steps.length - 1)]!;
  const spec = useMemo(() => deriveScene(step.template, step.cell), [step]);
  const options = useMemo(() => [...step.instance.options].sort((a, b) => a.position - b.position), [step]);
  const mine = picks[step.key];

  function choose(polarity: "act" | "omit") {
    save({ ...picks, [step.key]: polarity });
    setRun((prev) => ({ polarity, by: "you", key: (prev?.key ?? 0) + 1 }));
    // Let the figure play before the numbers arrive, so the choice is felt first.
    window.setTimeout(() => setRevealed(true), 1400);
  }

  function go(to: number) {
    setAt(to);
    setRun(null);
    setRevealed(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function restart() {
    save({});
    go(0);
  }

  if (finished) return <Summary steps={steps} picks={picks} onRestart={restart} onJump={go} />;

  const actLabel = options.find((o) => o.polarity === "act")?.label ?? "Act";

  return (
    <div className="play">
      <ol className="play-dots" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              aria-current={i === at ? "step" : undefined}
              className={picks[s.key] ? "done" : undefined}
              onClick={() => go(i)}
              aria-label={`${i + 1}. ${s.title}${picks[s.key] ? " (answered)" : ""}`}
            >
              {i + 1}
            </button>
          </li>
        ))}
      </ol>

      <header className="play-head">
        <p className="eyebrow">
          Dilemma {at + 1} of {steps.length}
        </p>
        <h1>{step.title}</h1>
        <p className="play-blurb">{step.blurb}</p>
      </header>

      {spec ? (
        <div className="play-figure">
          <Scene
            key={`${sceneKey(spec)}-${step.key}`}
            spec={spec}
            run={run}
            figure={at + 1}
            title={step.title}
            factors="5 threatened · 1 sacrificed"
            onActuate={mine ? undefined : () => choose("act")}
          />
        </div>
      ) : null}

      <div className="play-card">
        <p className="narrative">{step.instance.narrative}</p>
        <p className="question">{step.instance.question}</p>
        <div className="play-options">
          {options.map((o, i) => (
            <button
              key={o.id}
              type="button"
              className={mine === o.polarity ? "play-opt picked" : "play-opt"}
              aria-pressed={mine === o.polarity}
              onClick={() => choose(o.polarity)}
            >
              <span className="letter">{LETTERS[i]}</span>
              <span>{o.label}</span>
            </button>
          ))}
        </div>

        {mine && (revealed || run === null) ? (
          <Reveal step={step} mine={mine} actLabel={actLabel} />
        ) : mine ? (
          <p className="play-wait">…</p>
        ) : (
          <p className="play-hint">There is no right answer. Your choice stays in this browser.</p>
        )}
      </div>

      <nav className="play-nav">
        <button type="button" className="ghost" disabled={at === 0} onClick={() => go(at - 1)}>
          ← Back
        </button>
        <button type="button" className="primary" disabled={!mine} onClick={() => go(at + 1)}>
          {at === steps.length - 1 ? "See how you compare →" : "Next dilemma →"}
        </button>
      </nav>
    </div>
  );
}

/** The step's models as strip lanes: asked and acting kept apart, never pooled. */
function lanesOf(step: PlayStep): StripLane[] {
  const pts = (list: PlayModel[]) =>
    list.flatMap((m) =>
      m.rate === null ? [] : [{ key: modelKey(m.label), id: m.id, label: m.label, value: m.rate, n: m.n, interval: m.interval, slot: m.slot }],
    );
  const lanes: StripLane[] = [{ id: "prompt", label: "Models asked", points: pts(step.models) }];
  if (step.agents.length > 0) lanes.push({ id: "mcp_tool", label: "Agents acting", points: pts(step.agents) });
  return lanes.filter((l) => l.points.length > 0);
}

function humansOf(step: PlayStep) {
  return step.people
    .filter((p) => p.value !== null)
    .map((p, i) => ({ id: `${p.short}-${i}`, label: p.short, value: p.value as number, note: p.measure, href: p.href }));
}

/** How many models went the same way as you, most of the time. Refusals are counted apart. */
function sidedWith(list: PlayModel[], mine: "act" | "omit") {
  const rated = list.filter((m) => m.rate !== null);
  const same = rated.filter((m) => (mine === "act" ? m.rate! > 0.5 : m.rate! < 0.5)).length;
  return { same, of: rated.length, refused: list.length - rated.length };
}

function Reveal({ step, mine, actLabel }: { step: PlayStep; mine: "act" | "omit"; actLabel: string }) {
  const humans = humansOf(step);
  const lanes = lanesOf(step);
  const asked = sidedWith(step.models, mine);
  const people = humans.length ? humans.filter((h) => (mine === "act" ? h.value > 0.5 : h.value < 0.5)).length : 0;
  return (
    <section className="reveal" aria-live="polite">
      <h2>You {mine === "act" ? "chose to act" : "chose not to act"}. Here is everyone else.</h2>
      <p className="reveal-key">
        {humans.length > 0 ? (
          <>
            In {people} of {humans.length} published stud{humans.length === 1 ? "y" : "ies"}, most people went your way.{" "}
          </>
        ) : null}
        {asked.of > 0 ? (
          <>
            {asked.same} of {asked.of} model{asked.of === 1 ? "" : "s"} usually did too.
          </>
        ) : null}
        {asked.refused > 0 ? ` ${asked.refused} refused to answer.` : ""}
      </p>
      {lanes.length > 0 || humans.length > 0 ? (
        <ScenarioStrip humans={humans} lanes={lanes} you={{ value: mine === "act" ? 1 : 0 }} intervals={false} />
      ) : null}
      <p className="reveal-scale">
        Each position is the share who chose &ldquo;{actLabel.replace(/\.$/, "")}&rdquo;. Agents acted through tools rather
        than answering, so they get their own row. Hover any mark to see which models it is.
      </p>
      {step.people
        .filter((p) => p.finding)
        .map((p) => (
          <p className="reveal-finding" key={p.short}>
            <b>{p.short}:</b> {p.finding}
          </p>
        ))}
      <p className="reveal-note">
        Studies worded the question differently from each other and from this page, so read these as direction, not distance.{" "}
        <Link href="/sources">Sources and exact quotes</Link>.
      </p>
    </section>
  );
}

function Summary({
  steps,
  picks,
  onRestart,
  onJump,
}: {
  steps: PlayStep[];
  picks: Picks;
  onRestart: () => void;
  onJump: (i: number) => void;
}) {
  // "Sided with most people": the majority of every numeric study agrees with you.
  const rows = steps.map((s, i) => {
    const mine = picks[s.key];
    const values = s.people.map((p) => p.value).filter((v): v is number => v !== null);
    const lo = values.length ? Math.min(...values) : null;
    const hi = values.length ? Math.max(...values) : null;
    const majority =
      values.length === 0 ? null : values.every((v) => v > 0.5) ? "act" : values.every((v) => v < 0.5) ? "omit" : "split";
    return { s, i, mine, lo, hi, majority };
  });
  const judged = rows.filter((r) => r.mine && r.majority && r.majority !== "split");
  const agreed = judged.filter((r) => r.majority === r.mine).length;

  return (
    <div className="play">
      <header className="play-head">
        <p className="eyebrow">Your answers</p>
        <h1>
          You sided with most people in {agreed} of {judged.length} dilemmas
        </h1>
        <p className="play-blurb">
          Counted only where every study agrees on which way the majority went. On the rest, people
          themselves are split &mdash; which is the interesting part.
        </p>
      </header>

      <ol className="summary">
        {rows.map(({ s, i, mine, lo, hi, majority }) => (
          <li key={s.key}>
            <div className="summary-top">
              <span className={`you ${mine ?? "none"}`}>{mine === "act" ? "You acted" : mine === "omit" ? "You did not act" : "Not answered"}</span>
              <button type="button" className="summary-title" onClick={() => onJump(i)}>
                {i + 1}. {s.title}
              </button>
              <span className="people">
                {lo === null ? "People: see the finding" : lo === hi ? `People: ${Math.round(lo * 100)}% acted` : `People: ${Math.round(lo! * 100)}–${Math.round(hi! * 100)}% acted`}
                {majority === "split" ? " · split" : ""}
              </span>
            </div>
            <ScenarioStrip humans={humansOf(s)} lanes={lanesOf(s)} you={mine ? { value: mine === "act" ? 1 : 0 } : null} intervals={false} />
          </li>
        ))}
      </ol>

      <div className="summary-cta">
        <Link className="primary" href="/results">
          Explore the full results →
        </Link>
        <Link className="ghost" href="/run">
          Run your own model
        </Link>
        <button type="button" className="ghost" onClick={onRestart}>
          Start over
        </button>
      </div>
    </div>
  );
}

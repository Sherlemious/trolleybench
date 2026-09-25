"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { PlayStep } from "../../lib/play";
import { deriveScene, sceneKey } from "../../lib/scene";
import Scene, { type SceneRun } from "../Scene";

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

function Reveal({ step, mine, actLabel }: { step: PlayStep; mine: "act" | "omit"; actLabel: string }) {
  const numeric = step.people.filter((p) => p.value !== null);
  return (
    <section className="reveal" aria-live="polite">
      <h2>How others answered</h2>
      <p className="reveal-key">
        Bars show the share who chose <b>&ldquo;{actLabel.replace(/\.$/, "")}&rdquo;</b>. You{" "}
        {mine === "act" ? "did" : "did not"}.
      </p>
      <ul className="reveal-bars">
        {numeric.map((p) => (
          <li key={p.short}>
            <span className="who">
              {p.href ? (
                <a href={p.href} target="_blank" rel="noreferrer">
                  {p.short}
                </a>
              ) : (
                p.short
              )}
              <span className="sub">people · {p.measure}</span>
            </span>
            <span className="track">
              <span className="fill human" style={{ width: `${(p.value ?? 0) * 100}%` }} />
            </span>
            <span className="val">{Math.round((p.value ?? 0) * 100)}%</span>
          </li>
        ))}
        {step.models.map((m) => (
          <li key={m.label} className={`model s${m.slot}`}>
            <span className="who">
              <span className="mono">{m.label}</span>
              <span className="sub">model · {m.n} answers</span>
            </span>
            <span className="track">
              {m.rate !== null ? <span className="fill" style={{ width: `${m.rate * 100}%` }} /> : null}
            </span>
            <span className="val">{m.rate === null ? "refused" : `${Math.round(m.rate * 100)}%`}</span>
          </li>
        ))}
      </ul>
      {step.people
        .filter((p) => p.finding)
        .map((p) => (
          <p className="reveal-finding" key={p.short}>
            <b>{p.short}:</b> {p.finding}
          </p>
        ))}
      <p className="reveal-note">
        Studies worded the question differently from each other and from this page, so read these as
        direction, not distance. <Link href="/sources">Sources and exact quotes</Link>.
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

      <ul className="summary">
        {rows.map(({ s, i, mine, lo, hi, majority }) => (
          <li key={s.key}>
            <button type="button" className="summary-title" onClick={() => onJump(i)}>
              {i + 1}. {s.title}
            </button>
            <span className={`you ${mine ?? "none"}`}>{mine === "act" ? "you acted" : mine === "omit" ? "you did not act" : "not answered"}</span>
            <span className="people">
              {lo === null ? "people: see finding" : lo === hi ? `people: ${Math.round(lo * 100)}% acted` : `people: ${Math.round(lo! * 100)}–${Math.round(hi! * 100)}% acted`}
              {majority === "split" ? " · split" : ""}
            </span>
            <span className="models">
              {s.models.map((m) => (
                <span key={m.label} className={`chip s${m.slot}`}>
                  {m.label}: {m.rate === null ? "refused" : `${Math.round(m.rate * 100)}%`}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>

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

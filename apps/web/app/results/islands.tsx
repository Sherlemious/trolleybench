"use client";

import { useState } from "react";
import type { SayDoExample, SayDoModel, ScenarioGuide } from "../../lib/analysis";
import { MODE_LABEL, modelKey } from "../../lib/display";
import type { ClientGroup } from "../../lib/view/results";
import { useFocus } from "../focus";
import ModePanel from "./ModePanel";
import SayDo from "./SayDo";

/**
 * Say versus do, cell by cell. Its table has three columns per model, so it shows the
 * highlighted models - or the first three - rather than every model at once.
 */
export function SayDoFocused({ models, scenarios, example }: { models: SayDoModel[]; scenarios: ScenarioGuide[]; example: SayDoExample | null }) {
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

/** The mode switch and table of the "Every model" panel; the panel chrome is server-rendered. */
export function EveryModelTable({ groups, modes }: { groups: ClientGroup[]; modes: Record<string, { title: string; body: string }> }) {
  const [mode, setMode] = useState(groups[0]?.mode ?? "prompt");
  const group = groups.find((g) => g.mode === mode) ?? groups[0];
  if (!group) return null;
  const copy = modes[group.mode];
  return (
    <>
      {groups.length > 1 ? (
        <div className="seg every-modes" role="group" aria-label="Mode">
          {groups.map((g) => (
            <button key={g.mode} type="button" aria-pressed={g.mode === group.mode} onClick={() => setMode(g.mode)}>
              {MODE_LABEL[g.mode] ?? g.mode} · {g.models.length}
            </button>
          ))}
        </div>
      ) : null}
      {copy ? <p className="intro">{copy.body}</p> : null}
      <ModePanel key={group.mode} group={group} />
    </>
  );
}

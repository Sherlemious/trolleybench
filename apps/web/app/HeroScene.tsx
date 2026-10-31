"use client";

import Link from "next/link";
import { useState } from "react";
import type { SceneSpec } from "../lib/scene";
import Scene, { type SceneRun } from "./Scene";

const SWITCH: SceneSpec = { kind: "lever", nThreatened: 5, nSacrificed: 1, agentRole: "bystander" };

/** The landing figure: the switch, live. Pull the lever in the figure and it plays out. */
export default function HeroScene() {
  const [run, setRun] = useState<SceneRun | null>(null);
  return (
    <div className="hero-figure">
      <div className="play-figure">
        <Scene
          spec={SWITCH}
          run={run}
          figure={1}
          title="The switch"
          factors="5 threatened · 1 sacrificed"
          onActuate={run ? undefined : () => setRun({ polarity: "act", by: "you", key: Date.now() })}
        />
      </div>
      <p className="hero-figure-note">
        {run ? (
          <>
            You pulled it. In published studies, most people say they would too.{" "}
            <Link href="/play">Now try the footbridge →</Link>
          </>
        ) : (
          <>Try it: the lever in the figure is live.</>
        )}
      </p>
    </div>
  );
}

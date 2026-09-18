import type { UiTemplate } from "./load";

/**
 * What the animated figure needs to know about a design cell. Derived, not authored:
 * the pack stays the single source of truth and the scene is a projection of it.
 */
export type SceneKind = "lever" | "footbridge" | "loop" | "trapdoor" | "transplant";

export interface SceneSpec {
  kind: SceneKind;
  nThreatened: number;
  nSacrificed: number;
  agentRole: "bystander" | "driver";
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Map a template plus a chosen cell onto a drawable scene, or null if we can't draw it honestly. */
export function deriveScene(t: UiTemplate, cell: Record<string, string>): SceneSpec | null {
  const values: Record<string, string | number | boolean> = {};
  for (const f of t.factors) {
    const lv = f.levels.find((l) => l.id === cell[f.id]);
    if (lv) Object.assign(values, lv.values);
  }

  let kind: SceneKind | null;
  switch (t.mechanism) {
    case "lever":
    case "footbridge":
    case "loop":
    case "trapdoor":
    case "transplant":
      kind = t.mechanism;
      break;
    case "custom": {
      // The personal-force dissociation names its mechanism in a factor.
      const v = cell.mechanism_variant;
      kind = v === "footbridge" ? "footbridge" : v === "trapdoor" ? "trapdoor" : v === "switch" ? "lever" : null;
      break;
    }
    default:
      kind = null;
  }
  if (!kind) return null;

  return {
    kind,
    nThreatened: num(values.n_threatened, 5),
    nSacrificed: num(values.n_sacrificed, 1),
    agentRole: cell.agent_role === "driver" ? "driver" : "bystander",
  };
}

/** A stable string for keying the scene so a changed cell remounts it and replays the entrance. */
export function sceneKey(s: SceneSpec): string {
  return `${s.kind}:${s.nThreatened}:${s.nSacrificed}:${s.agentRole}`;
}

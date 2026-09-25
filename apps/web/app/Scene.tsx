"use client";

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SceneSpec } from "../lib/scene";

/**
 * The figure. An oblique-projection technical drawing of the dilemma that animates:
 * the trolley enters, waits at the decision point, and plays the chosen outcome.
 *
 * Everything is derived from the SceneSpec, which is derived from the pack, so the
 * drawing cannot say something the stimulus does not. Plan coordinates are
 * (x: along, d: depth away from the viewer, h: height); `proj` flattens them.
 */

export interface SceneRun {
  polarity: "act" | "omit";
  by: "you" | "subject";
  /** Who the subject is, e.g. "llama3.2:3b". The figure names them rather than guessing. */
  label?: string;
  key: number;
}

export type ScenePhase = "enter" | "hold" | "throw" | "run" | "done";

interface Props {
  spec: SceneSpec;
  run: SceneRun | null;
  figure: number;
  title: string;
  factors: string;
  onActuate?: () => void;
}

/* ------------------------------------------------------------------ projection */

const VW = 960;
const VH = 324;
const KX = 0.5;
const KY = 0.74;
const Y0 = 296;

interface Pt { x: number; d: number }
interface Sp { x: number; y: number }

const r = (n: number) => Math.round(n * 10) / 10;
const proj = (x: number, d: number, h = 0): Sp => ({ x: x + KX * d, y: Y0 - KY * d - h });
const P = (x: number, d: number, h = 0): string => { const p = proj(x, d, h); return `${r(p.x)},${r(p.y)}`; };
const poly = (pts: Sp[]) => pts.map((p) => `${r(p.x)},${r(p.y)}`).join(" ");
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInQuad = (t: number) => t * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, d: a.d - b.d });
const unit = (v: Pt): Pt => { const l = Math.hypot(v.x, v.d) || 1; return { x: v.x / l, d: v.d / l }; };

function bez(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 28): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      d: u * u * u * p0.d + 3 * u * u * t * p1.d + 3 * u * t * t * p2.d + t * t * t * p3.d,
    });
  }
  return out;
}

/** A polyline in plan space with arc-length lookup. Routes are x-monotonic. */
class Route {
  readonly pts: Pt[];
  readonly cum: number[];
  readonly length: number;
  constructor(raw: Pt[]) {
    const pts: Pt[] = [];
    for (const p of raw) {
      const last = pts[pts.length - 1];
      if (!last || Math.abs(last.x - p.x) > 1e-6 || Math.abs(last.d - p.d) > 1e-6) pts.push(p);
    }
    this.pts = pts;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].d - pts[i - 1].d));
    }
    this.cum = cum;
    this.length = cum[cum.length - 1] ?? 0;
  }
  at(s: number): { x: number; d: number; a: number } {
    const { pts, cum } = this;
    if (pts.length < 2) return { x: pts[0]?.x ?? 0, d: pts[0]?.d ?? 0, a: 0 };
    let i = 1;
    if (s >= this.length) i = pts.length - 1;
    else if (s > 0) while (i < pts.length - 1 && cum[i] < s) i++;
    const a = pts[i - 1], b = pts[i];
    const seg = cum[i] - cum[i - 1];
    const t = seg > 0 ? (s - cum[i - 1]) / seg : 0;
    return { x: a.x + (b.x - a.x) * t, d: a.d + (b.d - a.d) * t, a: Math.atan2(b.d - a.d, b.x - a.x) };
  }
  /** Arc length at which the route first reaches plan x. */
  sAtX(x: number): number {
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      if (b.x >= x) {
        const t = b.x === a.x ? 0 : clamp01((x - a.x) / (b.x - a.x));
        return this.cum[i - 1] + t * (this.cum[i] - this.cum[i - 1]);
      }
    }
    return this.length;
  }
  path(): string {
    return this.pts.map((p, i) => `${i ? "L" : "M"}${P(p.x, p.d)}`).join("");
  }
}

/* ------------------------------------------------------------------ geometry */

interface Member { x: number; d: number; scale: number; delay: number }
interface Group {
  id: string;
  route: "act" | "omit";
  members: Member[];
  label: string;
  side: "near" | "far";
}
interface SceneLabel {
  x: number;
  d: number;
  h?: number;
  text: string;
  anchor?: "start" | "middle" | "end";
  leader?: { x: number; d: number; h?: number };
}
interface TrackGeom {
  tracks: Route[];
  routes: { act: Route; omit: Route };
  hold: number;
  sStart: number;
  stopAt: { act?: number; omit?: number };
  groups: Group[];
  labels: SceneLabel[];
  switchAt?: { pt: Pt; mainDir: Pt; sideDir: Pt };
  lever?: Pt;
  switchBox?: Pt;
  you?: { x: number; d: number; h: number };
  signal?: Pt;
  bridge?: { x: number; d0: number; d1: number; w: number; h: number };
  gantry?: { x: number; d0: number; d1: number; h: number; deck: number };
  stranger?: { x: number; d: number; h: number };
}

const D_MAIN = 70;
const D_SIDE = 200;
const X0 = -200;
const X1 = 1200;
const L = 72; // trolley length

const jitter = (i: number, k: number, seed: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233 + seed * 3.7) * 43758.5453;
  return v - Math.floor(v);
};

function members(n: number, cx: number, d: number, seed: number): Member[] {
  const out: Member[] = [];
  const j = (i: number, k: number) => jitter(i, k, seed);
  if (n <= 6) {
    for (let i = 0; i < n; i++) {
      out.push({ x: cx + (i - (n - 1) / 2) * 13, d: d + (j(i, 1) - 0.5) * 10, scale: 1, delay: j(i, 2) * 0.08 });
    }
  } else if (n <= 12) {
    const cols = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const row = i % 2, col = Math.floor(i / 2);
      out.push({
        x: cx + (col - (cols - 1) / 2) * 13 + (row ? 6 : 0),
        d: d + (row ? 8 : -8) + (j(i, 1) - 0.5) * 4,
        scale: 1,
        delay: j(i, 2) * 0.1,
      });
    }
  } else {
    const rows = 5, cols = Math.ceil(n / rows);
    for (let i = 0; i < n; i++) {
      const col = Math.floor(i / rows), row = i % rows;
      out.push({
        x: cx + (col - (cols - 1) / 2) * 6.6 + (j(i, 1) - 0.5) * 2,
        d: d + (row - (rows - 1) / 2) * 8.5 + (j(i, 2) - 0.5) * 2,
        scale: 0.58,
        delay: j(i, 3) * 0.14,
      });
    }
  }
  return out;
}

const mainLine = () => new Route([{ x: X0, d: D_MAIN }, { x: X1, d: D_MAIN }]);
const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

/** Label a group: near-side groups are captioned below, far-side groups above. */
function groupLabel(grp: Group): SceneLabel {
  const xs = grp.members.map((m) => m.x), ds = grp.members.map((m) => m.d);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const d0 = Math.min(...ds), d1 = Math.max(...ds);
  return grp.side === "near"
    ? { x: cx, d: d0 - 44, text: grp.label, leader: { x: cx, d: d0 - 10 } }
    : { x: cx, d: d1 + 34, h: 46, text: grp.label, leader: { x: cx, d: d1 + 6, h: 26 } };
}

function leverGeom(spec: SceneSpec): TrackGeom {
  const mn = mainLine();
  const sw = { x: 400, d: D_MAIN };
  const side = [...bez(sw, { x: 495, d: D_MAIN }, { x: 505, d: D_SIDE }, { x: 600, d: D_SIDE }), { x: X1, d: D_SIDE }];
  const act = new Route([{ x: X0, d: D_MAIN }, ...side]);
  const hold = act.sAtX(sw.x) - 108;
  const by = spec.agentRole === "bystander";
  const groups: Group[] = [
    { id: "main", route: "omit", members: members(spec.nThreatened, 800, D_MAIN, 1), label: `main line · ${people(spec.nThreatened)}`, side: "near" },
    { id: "side", route: "act", members: members(spec.nSacrificed, 730, D_SIDE, 2), label: `siding · ${people(spec.nSacrificed)}`, side: "far" },
  ];
  return {
    tracks: [mn, new Route(side)],
    routes: { act, omit: mn },
    hold,
    sStart: hold - 440,
    stopAt: {},
    groups,
    labels: [...groups.map(groupLabel), ...(by ? [{ x: 296, d: 4, text: "you", anchor: "end" as const }] : [])],
    switchAt: { pt: sw, mainDir: { x: 1, d: 0 }, sideDir: unit(sub(side[5], side[0])) },
    lever: by ? { x: 346, d: 16 } : undefined,
    you: by ? { x: 322, d: 10, h: 0 } : undefined,
    signal: { x: 386, d: 104 },
  };
}

function loopGeom(spec: SceneSpec): TrackGeom {
  const mn = mainLine();
  const a = { x: 380, d: D_MAIN };
  const b = { x: 760, d: D_MAIN };
  const loopPts = [
    ...bez(a, { x: 455, d: D_MAIN }, { x: 420, d: D_SIDE }, { x: 490, d: D_SIDE }),
    { x: 640, d: D_SIDE },
    ...bez({ x: 640, d: D_SIDE }, { x: 705, d: D_SIDE }, { x: 690, d: D_MAIN }, b),
  ];
  const act = new Route([{ x: X0, d: D_MAIN }, ...loopPts, { x: X1, d: D_MAIN }]);
  const heavyX = 565;
  const hold = act.sAtX(a.x) - 108;
  const onLoop = members(spec.nSacrificed, heavyX, D_SIDE, 2).map((m) => ({ ...m, scale: spec.nSacrificed === 1 ? 1.25 : m.scale }));
  const groups: Group[] = [
    { id: "main", route: "omit", members: members(spec.nThreatened, 850, D_MAIN, 1), label: `main line · ${people(spec.nThreatened)}`, side: "near" },
    { id: "loop", route: "act", members: onLoop, label: `on the loop · ${people(spec.nSacrificed)}`, side: "far" },
  ];
  return {
    tracks: [mn, new Route(loopPts)],
    routes: { act, omit: mn },
    hold,
    sStart: hold - 440,
    stopAt: { act: act.sAtX(heavyX - 18) - L / 2 },
    groups,
    labels: [...groups.map(groupLabel), { x: 276, d: 4, text: "you", anchor: "end" }],
    switchAt: { pt: a, mainDir: { x: 1, d: 0 }, sideDir: unit(sub(loopPts[5], loopPts[0])) },
    lever: { x: 326, d: 16 },
    you: { x: 302, d: 10, h: 0 },
    signal: { x: 366, d: 104 },
  };
}

function footbridgeGeom(spec: SceneSpec): TrackGeom {
  const mn = mainLine();
  const bx = 470;
  const hold = mn.sAtX(bx) - 190;
  const groups: Group[] = [
    { id: "main", route: "omit", members: members(spec.nThreatened, 800, D_MAIN, 1), label: `main line · ${people(spec.nThreatened)}`, side: "near" },
  ];
  return {
    tracks: [mn],
    routes: { act: mn, omit: mn },
    hold,
    sStart: hold - 440,
    stopAt: { act: mn.sAtX(bx - 28) - L / 2 },
    groups,
    labels: [
      ...groups.map(groupLabel),
      { x: bx - 64, d: 112, h: 86, text: "you", anchor: "end", leader: { x: bx - 8, d: 112, h: 78 } },
      { x: bx + 56, d: D_MAIN, h: 92, text: "the stranger", anchor: "start", leader: { x: bx + 8, d: D_MAIN, h: 80 } },
    ],
    bridge: { x: bx, d0: 8, d1: 150, w: 44, h: 60 },
    stranger: { x: bx, d: D_MAIN, h: 60 },
    you: { x: bx, d: 112, h: 60 },
  };
}

function trapdoorGeom(spec: SceneSpec): TrackGeom {
  const mn = mainLine();
  const gx = 470;
  const hold = mn.sAtX(gx) - 190;
  const groups: Group[] = [
    { id: "main", route: "omit", members: members(spec.nThreatened, 800, D_MAIN, 1), label: `main line · ${people(spec.nThreatened)}`, side: "near" },
  ];
  return {
    tracks: [mn],
    routes: { act: mn, omit: mn },
    hold,
    sStart: hold - 440,
    stopAt: { act: mn.sAtX(gx - 28) - L / 2 },
    groups,
    labels: [
      ...groups.map(groupLabel),
      { x: 332, d: 4, text: "you", anchor: "end" },
      { x: gx + 56, d: D_MAIN, h: 96, text: "the stranger", anchor: "start", leader: { x: gx + 8, d: D_MAIN, h: 82 } },
    ],
    gantry: { x: gx, d0: 36, d1: 104, h: 76, deck: 62 },
    stranger: { x: gx, d: D_MAIN, h: 62 },
    switchBox: { x: 384, d: 16 },
    you: { x: 358, d: 10, h: 0 },
  };
}

function buildGeom(spec: SceneSpec): TrackGeom | null {
  switch (spec.kind) {
    case "lever": return leverGeom(spec);
    case "loop": return loopGeom(spec);
    case "footbridge": return footbridgeGeom(spec);
    case "trapdoor": return trapdoorGeom(spec);
    default: return null;
  }
}

/* ------------------------------------------------------------------ boxes */

interface Face { pts: Sp[]; kind: "front" | "back" | "near" | "far"; vis: boolean; depth: number; i: number; j: number }
interface BoxFaces { g: Sp[]; rf: Sp[]; walls: Face[]; corners: Pt[] }

function boxFaces(x: number, d: number, along: number, across: number, h: number, a = 0): BoxFaces {
  const ca = Math.cos(a), sa = Math.sin(a);
  const local: Array<[number, number]> = [[along / 2, -across / 2], [along / 2, across / 2], [-along / 2, across / 2], [-along / 2, -across / 2]];
  const corners = local.map(([u, v]) => ({ x: x + u * ca - v * sa, d: d + u * sa + v * ca }));
  const g = corners.map((c) => proj(c.x, c.d, 0));
  const rf = corners.map((c) => proj(c.x, c.d, h));
  const walls: Face[] = [0, 1, 2, 3].map((i) => {
    const j = (i + 1) % 4;
    const e = sub(corners[j], corners[i]);
    const n = { x: e.d, d: -e.x };
    const vis = n.d < 0 || n.x > 0;
    const kind: Face["kind"] = i === 0 ? "front" : i === 2 ? "back" : n.d < 0 ? "near" : "far";
    return { pts: [g[i], g[j], rf[j], rf[i]], kind, vis, depth: (corners[i].d + corners[j].d) / 2, i, j };
  });
  walls.sort((p, q) => (p.vis === q.vis ? q.depth - p.depth : p.vis ? 1 : -1));
  return { g, rf, walls, corners };
}

/** Affine point on a wall parallelogram: u along the edge, v up the height. */
function onWall(b: BoxFaces, f: Face, u: number, v: number): Sp {
  const A = b.g[f.i], B = b.g[f.j], D = b.rf[f.i];
  return { x: A.x + (B.x - A.x) * u + (D.x - A.x) * v, y: A.y + (B.y - A.y) * u + (D.y - A.y) * v };
}

function onRoof(b: BoxFaces, u: number, v: number): Sp {
  const A = b.rf[3], B = b.rf[0], D = b.rf[2];
  return { x: A.x + (B.x - A.x) * u + (D.x - A.x) * v, y: A.y + (B.y - A.y) * u + (D.y - A.y) * v };
}

function Box({ x, d, along, across, h, cls }: { x: number; d: number; along: number; across: number; h: number; cls: string }) {
  const b = boxFaces(x, d, along, across, h);
  return (
    <g className={cls}>
      {b.walls.map((w) => (
        <polygon key={w.i} points={poly(w.pts)} className={`wall ${w.kind}`} />
      ))}
      <polygon points={poly(b.rf)} className="roof" />
    </g>
  );
}

/* ------------------------------------------------------------------ sprites */

/** `struck` topples; `lost` fades in place — the ward has no impact to draw. */
type FigState = "idle" | "struck" | "spared" | "lost";

const Figure = memo(function Figure({
  px, py, scale, state, delay, you, walk = 0,
}: { px: number; py: number; scale: number; state: FigState; delay: number; you?: boolean; walk?: number }) {
  return (
    <g transform={`translate(${r(px + walk)} ${r(py)}) scale(${scale})`} className="sp-fig">
      {you ? <ellipse className="you-ring" rx="9.5" ry="3.8" /> : null}
      <ellipse className="shadow" rx="5.4" ry="2.2" />
      <g className={`fig ${state}${you ? " you" : ""}`} style={{ animationDelay: `${delay}s` }}>
        <use href="#fig" />
      </g>
    </g>
  );
});

function Trolley({ x, d, a, driver, phase }: { x: number; d: number; a: number; driver: boolean; phase: string }) {
  const H = 28, W = 26;
  const b = boxFaces(x, d, L, W, H, a);
  const ca = Math.cos(a), sa = Math.sin(a);
  const f = { x: x + (L / 2) * ca, d: d + (L / 2) * sa };
  const reach = 120, spread = 40;
  const tipL = { x: f.x + reach * ca - spread * sa, d: f.d + reach * sa + spread * ca };
  const tipR = { x: f.x + reach * ca + spread * sa, d: f.d + reach * sa - spread * ca };
  const far = { x: f.x + reach * ca, d: f.d + reach * sa };
  const g0 = proj(f.x, f.d, 11), g1 = proj(far.x, far.d, 0);
  const roofPt = proj(x + 0.2 * L * ca, d + 0.2 * L * sa, H);
  return (
    <g className={`tram ${phase}`}>
      <defs>
        <linearGradient id="beam" gradientUnits="userSpaceOnUse" x1={r(g0.x)} y1={r(g0.y)} x2={r(g1.x)} y2={r(g1.y)}>
          <stop offset="0" stopColor="var(--beam)" stopOpacity="0.42" />
          <stop offset="1" stopColor="var(--beam)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon className="beam" points={poly([proj(f.x, f.d, 11), proj(tipL.x, tipL.d, 0), proj(tipR.x, tipR.d, 0)])} fill="url(#beam)" />
      <polygon className="tram-shadow" points={poly(b.g)} />
      <polygon className="tram-chassis" points={poly(b.g)} />
      {b.walls.map((w) => (
        <g key={w.i}>
          <polygon points={poly(w.pts)} className={`wall ${w.kind}`} />
          {w.vis && (w.kind === "near" || w.kind === "far")
            ? [0, 1, 2, 3].map((k) => {
                const u0 = 0.09 + k * 0.215, u1 = u0 + 0.16;
                return (
                  <polygon
                    key={k}
                    className="window"
                    points={poly([onWall(b, w, u0, 0.42), onWall(b, w, u1, 0.42), onWall(b, w, u1, 0.8), onWall(b, w, u0, 0.8)])}
                  />
                );
              })
            : null}
          {w.vis && w.kind === "front" ? (
            <>
              <polygon className="window" points={poly([onWall(b, w, 0.16, 0.42), onWall(b, w, 0.84, 0.42), onWall(b, w, 0.84, 0.82), onWall(b, w, 0.16, 0.82)])} />
              <circle className="lamp" cx={r(onWall(b, w, 0.5, 0.2).x)} cy={r(onWall(b, w, 0.5, 0.2).y)} r="2.6" />
            </>
          ) : null}
        </g>
      ))}
      <polygon points={poly(b.rf)} className="roof" />
      <polygon points={poly([onRoof(b, 0.12, 0.3), onRoof(b, 0.88, 0.3), onRoof(b, 0.88, 0.7), onRoof(b, 0.12, 0.7)])} className="roof-vent" />
      {driver ? (
        <g transform={`translate(${r(roofPt.x)} ${r(roofPt.y)})`}>
          <ellipse className="you-ring" rx="8" ry="3.2" />
          <g className="fig you" transform="scale(0.78)"><use href="#fig" /></g>
        </g>
      ) : null}
    </g>
  );
}

function Lever({ x, d, throwT, active, onClick }: { x: number; d: number; throwT: number; active: boolean; onClick?: () => void }) {
  const base = proj(x, d, 0);
  const piv = proj(x, d, 4);
  const ang = (-42 + 84 * throwT) * (Math.PI / 180);
  const tip = proj(x + 21 * Math.sin(ang), d, 4 + 21 * Math.cos(ang));
  return (
    <g className={`lever${active ? " active" : ""}${throwT > 0.5 ? " thrown" : ""}`}>
      <ellipse className="lever-base" cx={r(base.x)} cy={r(base.y)} rx="9" ry="3.8" />
      <line className="lever-post" x1={r(piv.x)} y1={r(piv.y)} x2={r(base.x)} y2={r(base.y)} />
      <line className="lever-arm" x1={r(piv.x)} y1={r(piv.y)} x2={r(tip.x)} y2={r(tip.y)} />
      <circle className="lever-knob" cx={r(tip.x)} cy={r(tip.y)} r="3.4" />
      {active ? (
        <g className="hit" onClick={onClick} role="button" aria-label="Pull the lever">
          <circle cx={r(piv.x)} cy={r(piv.y - 10)} r="24" />
          <text x={r(piv.x)} y={r(piv.y) - 32} textAnchor="middle" className="hit-label">pull</text>
        </g>
      ) : null}
    </g>
  );
}

function SwitchBox({ x, d, throwT, active, onClick }: { x: number; d: number; throwT: number; active: boolean; onClick?: () => void }) {
  const top = proj(x, d, 12);
  const ang = (-40 + 80 * throwT) * (Math.PI / 180);
  const tip = proj(x + 9 * Math.sin(ang), d, 12 + 9 * Math.cos(ang));
  return (
    <g className={`switchbox${active ? " active" : ""}`}>
      <Box x={x} d={d} along={16} across={12} h={12} cls="struct-box" />
      <line className="lever-arm" x1={r(top.x)} y1={r(top.y)} x2={r(tip.x)} y2={r(tip.y)} />
      <circle className="lever-knob" cx={r(tip.x)} cy={r(tip.y)} r="2.4" />
      {active ? (
        <g className="hit" onClick={onClick} role="button" aria-label="Flip the switch">
          <circle cx={r(top.x)} cy={r(top.y - 4)} r="22" />
          <text x={r(top.x)} y={r(top.y) - 26} textAnchor="middle" className="hit-label">flip</text>
        </g>
      ) : null}
    </g>
  );
}

function Signal({ x, d, state }: { x: number; d: number; state: string }) {
  const b = proj(x, d, 0), t = proj(x, d, 26);
  return (
    <g className={`signal ${state}`}>
      <ellipse className="shadow" cx={r(b.x)} cy={r(b.y)} rx="3" ry="1.4" />
      <line className="post" x1={r(b.x)} y1={r(b.y)} x2={r(t.x)} y2={r(t.y)} />
      <circle className="glow" cx={r(t.x)} cy={r(t.y)} r="10" />
      <circle className="lamp" cx={r(t.x)} cy={r(t.y)} r="4.2" />
    </g>
  );
}

function Pillar({ x, d, h }: { x: number; d: number; h: number }) {
  return <polygon className="pillar" points={poly([proj(x - 3, d, 0), proj(x + 3, d, 0), proj(x + 3, d, h), proj(x - 3, d, h)])} />;
}

function Railing({ x, da, db, h }: { x: number; da: number; db: number; h: number }) {
  const posts: ReactNode[] = [];
  for (let d = da; d <= db + 0.01; d += 24) {
    const a = proj(x, d, h), b = proj(x, d, h + 14);
    posts.push(<line key={d} className="rail-post" x1={r(a.x)} y1={r(a.y)} x2={r(b.x)} y2={r(b.y)} />);
  }
  const p = proj(x, da, h + 14), q = proj(x, db, h + 14);
  return (
    <g>
      {posts}
      <line className="rail-top" x1={r(p.x)} y1={r(p.y)} x2={r(q.x)} y2={r(q.y)} />
    </g>
  );
}

function DeckHalf({ x0, x1, da, db, h, near }: { x0: number; x1: number; da: number; db: number; h: number; near: boolean }) {
  return (
    <g className="deck">
      <polygon className="deck-top" points={poly([proj(x0, da, h), proj(x1, da, h), proj(x1, db, h), proj(x0, db, h)])} />
      <polygon className="deck-side" points={poly([proj(x1, da, h), proj(x1, db, h), proj(x1, db, h - 6), proj(x1, da, h - 6)])} />
      {near ? <polygon className="deck-front" points={poly([proj(x0, da, h), proj(x1, da, h), proj(x1, da, h - 6), proj(x0, da, h - 6)])} /> : null}
      <Railing x={x0} da={da} db={db} h={h} />
      <Railing x={x1} da={da} db={db} h={h} />
    </g>
  );
}

function Flap({ x0, x1, hinge, dir, h, t }: { x0: number; x1: number; hinge: number; dir: 1 | -1; h: number; t: number }) {
  const ang = t * 82 * (Math.PI / 180);
  const fd = hinge + dir * 12 * Math.cos(ang);
  const fh = h - 12 * Math.sin(ang);
  return <polygon className="flap" points={poly([proj(x0, hinge, h), proj(x1, hinge, h), proj(x1, fd, fh), proj(x0, fd, fh)])} />;
}

function Label({ x, d, h = 0, text, anchor = "middle", leader }: { x: number; d: number; h?: number; text: string; anchor?: "start" | "middle" | "end"; leader?: { x: number; d: number; h?: number } }) {
  const p = proj(x, d, h);
  const q = leader ? proj(leader.x, leader.d, leader.h ?? 0) : null;
  return (
    <g className="annot">
      {q ? <line className="leader" x1={r(p.x)} y1={r(p.y - 4)} x2={r(q.x)} y2={r(q.y)} /> : null}
      <text x={r(p.x)} y={r(p.y)} textAnchor={anchor}>{text}</text>
    </g>
  );
}

/* ------------------------------------------------------------------ animation */

interface Anim {
  phase: ScenePhase;
  t: number;
  tr: number;
  s: number;
  throwT: number;
  impact: boolean;
}

const ENTER = 1.5;
const THROW = 0.38;

function stepTrack(a: Anim, dt: number, g: TrackGeom, pol: "act" | "omit" | null): Anim {
  const t = a.t + dt;
  switch (a.phase) {
    case "enter": {
      const k = easeOutCubic(Math.min(1, t / ENTER));
      const s = g.sStart + (g.hold - g.sStart) * k;
      // A choice made during the entrance is honoured on arrival rather than dropped.
      return t >= ENTER ? { ...a, phase: pol ? "throw" : "hold", t: 0, tr: 0, s: g.hold } : { ...a, t, s };
    }
    case "throw": {
      const throwT = easeInOut(Math.min(1, t / THROW));
      return t >= THROW ? { ...a, phase: "run", t: 0, tr: a.tr + dt, throwT: 1 } : { ...a, t, tr: a.tr + dt, throwT };
    }
    case "run": {
      const route = g.routes[pol ?? "omit"];
      const v = Math.min(340, 150 + 640 * t);
      const s = a.s + v * dt;
      const stop = pol ? g.stopAt[pol] : undefined;
      if (stop !== undefined && s >= stop) return { ...a, phase: "done", t: 0, tr: a.tr + dt, s: stop, impact: true };
      const p = route.at(s - L / 2);
      if (proj(p.x, p.d).x > VW + 40) return { ...a, phase: "done", t: 0, tr: a.tr + dt, s };
      return { ...a, t, tr: a.tr + dt, s };
    }
    default:
      return a;
  }
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const fn = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return reduced;
}

/** Runs a step function on animation frames while `running(state)` holds. */
function useTicker<S>(initial: S, stepFn: (s: S, dt: number) => S, running: (s: S) => boolean) {
  const ref = useRef<S>(initial);
  const [snap, setSnap] = useState<S>(initial);
  const raf = useRef(0);
  const stepRef = useRef(stepFn);
  stepRef.current = stepFn;
  const runningRef = useRef(running);
  runningRef.current = running;

  const start = (next: S) => {
    cancelAnimationFrame(raf.current);
    ref.current = next;
    setSnap(next);
    if (!runningRef.current(next)) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const out = stepRef.current(ref.current, dt);
      ref.current = out;
      setSnap(out);
      if (runningRef.current(out)) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return { snap, start, current: () => ref.current };
}

/* ------------------------------------------------------------------ track scene */

function TrackScene({
  spec, geom, run, onActuate, onPhase,
}: { spec: SceneSpec; geom: TrackGeom; run: SceneRun | null; onActuate?: () => void; onPhase: (p: ScenePhase) => void }) {
  const reduced = useReducedMotion();
  const pol = run?.polarity ?? null;
  const { snap: a, start, current } = useTicker<Anim>(
    { phase: "enter", t: 0, tr: 0, s: geom.sStart, throwT: 0, impact: false },
    (s, dt) => stepTrack(s, dt, geom, pol),
    (s) => s.phase === "enter" || s.phase === "throw" || s.phase === "run",
  );

  useEffect(() => {
    const cur = current();
    const enter: Anim = { phase: "enter", t: 0, tr: 0, s: geom.sStart, throwT: 0, impact: false };
    if (reduced) {
      if (!run) { start({ ...enter, phase: "hold", s: geom.hold }); return; }
      const stop = geom.stopAt[run.polarity];
      start({ phase: "done", t: 0, tr: 9, s: stop ?? geom.routes[run.polarity].length, throwT: 1, impact: stop !== undefined });
      return;
    }
    // Mount or rewind: play the entrance; it settles at the hold point.
    if (!run) { start(enter); return; }
    // Waiting at the decision point: act now.
    if (cur.phase === "hold") { start({ ...cur, phase: "throw", t: 0, tr: 0, throwT: 0, impact: false }); return; }
    // Still entering: the step function throws on arrival.
    if (cur.phase === "enter" && cur.t > 0) return;
    // Replay after (or during) a run: bring the trolley back in, then throw.
    start(enter);
  }, [geom, run?.key, reduced]);

  useEffect(() => { onPhase(a.phase); }, [a.phase, onPhase]);

  const route = geom.routes[pol ?? "omit"];
  const pos = route.at(a.s);
  const frontX = route.at(a.s + L / 2).x;
  const rolling = a.phase === "run" || a.phase === "done";
  const done = a.phase === "done";
  const holding = a.phase === "hold";

  const stateOf = (grp: Group, m: Member): FigState => {
    if (rolling && pol === grp.route && (frontX >= m.x - 18 || (done && a.impact))) return "struck";
    if (done && pol !== grp.route) return "spared";
    return "idle";
  };

  const dropT = done ? 1 : spec.kind === "trapdoor" ? clamp01((a.tr - 0.22) / 0.5) : clamp01(a.tr / 0.55);
  const flapT = done ? 1 : clamp01(a.tr / 0.4);
  const acting = pol === "act" && (a.phase === "throw" || rolling);

  // Every drawable thing carries a depth so the painter's order is right per frame.
  const sprites: Array<{ id: string; depth: number; h: number; node: ReactNode }> = [];

  for (const grp of geom.groups) {
    grp.members.forEach((m, i) => {
      const p = proj(m.x, m.d, 0);
      sprites.push({ id: `${grp.id}-${i}`, depth: m.d, h: 0, node: <Figure px={p.x} py={p.y} scale={m.scale} state={stateOf(grp, m)} delay={m.delay} /> });
    });
  }

  if (geom.you) {
    const p = proj(geom.you.x, geom.you.d, geom.you.h);
    sprites.push({ id: "you", depth: geom.you.d, h: geom.you.h, node: <Figure px={p.x} py={p.y} scale={1} state="idle" delay={0} you /> });
  }

  if (geom.stranger) {
    const h = geom.stranger.h * (1 - (acting ? easeInQuad(dropT) : 0));
    const p = proj(geom.stranger.x, geom.stranger.d, h);
    const st: FigState = done ? (a.impact ? "struck" : "spared") : "idle";
    sprites.push({ id: "stranger", depth: geom.stranger.d, h, node: <Figure px={p.x} py={p.y} scale={1.28} state={st} delay={0} /> });
  }

  if (geom.lever) {
    sprites.push({ id: "lever", depth: geom.lever.d, h: 0, node: <Lever x={geom.lever.x} d={geom.lever.d} throwT={pol === "act" ? a.throwT : 0} active={holding && !!onActuate} onClick={onActuate} /> });
  }
  if (geom.switchBox) {
    sprites.push({ id: "switchbox", depth: geom.switchBox.d, h: 0, node: <SwitchBox x={geom.switchBox.x} d={geom.switchBox.d} throwT={pol === "act" ? a.throwT : 0} active={holding && !!onActuate} onClick={onActuate} /> });
  }
  if (geom.signal) {
    const st = holding || a.phase === "enter" ? "wait" : pol ?? "wait";
    sprites.push({ id: "signal", depth: geom.signal.d, h: 0, node: <Signal x={geom.signal.x} d={geom.signal.d} state={st} /> });
  }

  if (geom.bridge) {
    const b = geom.bridge;
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2;
    sprites.push({
      id: "bridge-far", depth: b.d1, h: 0,
      node: (
        <g className="bridge">
          <Pillar x={x0} d={b.d1} h={b.h} /><Pillar x={x1} d={b.d1} h={b.h} />
          <DeckHalf x0={x0} x1={x1} da={D_MAIN} db={b.d1} h={b.h} near={false} />
        </g>
      ),
    });
    sprites.push({
      id: "bridge-near", depth: b.d0, h: 0,
      node: (
        <g className="bridge">
          <DeckHalf x0={x0} x1={x1} da={b.d0} db={D_MAIN} h={b.h} near />
          <Pillar x={x0} d={b.d0} h={b.h} /><Pillar x={x1} d={b.d0} h={b.h} />
        </g>
      ),
    });
    if (geom.stranger && holding && onActuate) {
      const hitP = proj(geom.stranger.x, geom.stranger.d, geom.stranger.h);
      sprites.push({
        id: "push-hit", depth: 0, h: 99,
        node: (
          <g className="hit" onClick={onActuate} role="button" aria-label="Push the stranger">
            <circle cx={r(hitP.x)} cy={r(hitP.y - 12)} r="24" />
            <text x={r(hitP.x)} y={r(hitP.y) - 40} textAnchor="middle" className="hit-label">push</text>
          </g>
        ),
      });
    }
  }

  if (geom.gantry) {
    const gt = geom.gantry;
    const x0 = gt.x - 16, x1 = gt.x + 16;
    const bp = proj(gt.x, gt.d0, gt.h), bq = proj(gt.x, gt.d1, gt.h);
    const hp = proj(gt.x, D_MAIN, gt.h), hq = proj(gt.x, D_MAIN, gt.deck + 2);
    sprites.push({
      id: "gantry-far", depth: gt.d1, h: 0,
      node: (
        <g className="gantry">
          <Pillar x={gt.x} d={gt.d1} h={gt.h} />
          <line className="beam-bar" x1={r(bp.x)} y1={r(bp.y)} x2={r(bq.x)} y2={r(bq.y)} />
          <line className="hanger" x1={r(hp.x)} y1={r(hp.y)} x2={r(hq.x)} y2={r(hq.y)} />
          <polygon className="frame" points={poly([proj(x0, 58, gt.deck), proj(x1, 58, gt.deck), proj(x1, 82, gt.deck), proj(x0, 82, gt.deck)])} />
        </g>
      ),
    });
    sprites.push({ id: "flap-far", depth: 82, h: gt.deck, node: <Flap x0={x0} x1={x1} hinge={82} dir={-1} h={gt.deck} t={acting ? flapT : 0} /> });
    sprites.push({ id: "flap-near", depth: 58, h: gt.deck, node: <Flap x0={x0} x1={x1} hinge={58} dir={1} h={gt.deck} t={acting ? flapT : 0} /> });
    sprites.push({ id: "gantry-near", depth: gt.d0, h: 0, node: <Pillar x={gt.x} d={gt.d0} h={gt.h} /> });
  }

  sprites.push({
    id: "trolley", depth: pos.d, h: 1,
    node: <Trolley x={pos.x} d={pos.d} a={pos.a} driver={spec.agentRole === "driver"} phase={a.phase} />,
  });

  sprites.sort((p, q) => (q.depth - p.depth) || (p.h - q.h));

  const blade = (() => {
    if (!geom.switchAt) return null;
    const sw = geom.switchAt;
    const t = pol === "act" ? a.throwT : 0;
    const dir = unit({ x: sw.mainDir.x + (sw.sideDir.x - sw.mainDir.x) * t, d: sw.mainDir.d + (sw.sideDir.d - sw.mainDir.d) * t });
    const p = proj(sw.pt.x, sw.pt.d), q = proj(sw.pt.x + dir.x * 34, sw.pt.d + dir.d * 34);
    return <line className={`blade${t > 0.5 ? " set" : ""}`} x1={r(p.x)} y1={r(p.y)} x2={r(q.x)} y2={r(q.y)} />;
  })();

  const driverLabel = spec.agentRole === "driver" ? proj(pos.x, pos.d, 66) : null;

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      className={`scene${done && a.impact ? " impact" : ""} phase-${a.phase}`}
      role="img"
      aria-label={`Diagram of the ${spec.kind} scenario`}
    >
      <Defs />
      <g className="ground">
        {geom.tracks.map((t, i) => {
          const dpath = t.path();
          return (
            <g key={i} className="track">
              <path d={dpath} className="t-ballast" />
              <path d={dpath} className="t-ties" />
              <path d={dpath} className="t-rail" pathLength={1} />
              <path d={dpath} className="t-rail-in" pathLength={1} />
            </g>
          );
        })}
        {blade}
      </g>
      <g className="world">
        {sprites.map((s) => <g key={s.id}>{s.node}</g>)}
      </g>
      <g className="labels">
        {geom.labels.map((l) => (
          <Label key={l.text} x={l.x} d={l.d} h={l.h} text={l.text} anchor={l.anchor} leader={l.leader} />
        ))}
        {driverLabel ? (
          <text className="annot-txt" x={r(driverLabel.x)} y={r(driverLabel.y)} textAnchor="middle">you · driving</text>
        ) : null}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ transplant */

interface TAnim { phase: ScenePhase; t: number; tr: number }

function transplantDuration(pol: "act" | "omit", n: number) {
  return pol === "act" ? 1.3 + 0.2 * n : 1.0 + 0.3 * n;
}

function TransplantScene({ spec, run, onPhase }: { spec: SceneSpec; run: SceneRun | null; onPhase: (p: ScenePhase) => void }) {
  const reduced = useReducedMotion();
  const pol = run?.polarity ?? null;
  const n = Math.min(spec.nThreatened, 6);
  const total = transplantDuration(pol ?? "omit", n);
  const { snap: a, start } = useTicker<TAnim>(
    { phase: "enter", t: 0, tr: 0 },
    (s, dt) => {
      const t = s.t + dt;
      if (s.phase === "enter") return t >= 1.2 ? { phase: "hold", t: 0, tr: 0 } : { ...s, t };
      if (s.phase === "run") return t >= total ? { phase: "done", t: 0, tr: total } : { ...s, t, tr: t };
      return s;
    },
    (s) => s.phase === "enter" || s.phase === "run",
  );

  useEffect(() => {
    if (!run) { start(reduced ? { phase: "hold", t: 0, tr: 0 } : { phase: "enter", t: 0, tr: 0 }); return; }
    start(reduced ? { phase: "done", t: 0, tr: total } : { phase: "run", t: 0, tr: 0 });
  }, [spec, run?.key, reduced]);

  useEffect(() => { onPhase(a.phase); }, [a.phase, onPhase]);

  const tr = a.phase === "done" ? total : a.tr;
  const rolling = a.phase === "run" || a.phase === "done";
  const patientState = (i: number): FigState => {
    if (!rolling) return "idle";
    if (pol === "act") return tr >= 1.0 + 0.2 * i ? "spared" : "idle";
    return tr >= 0.5 + 0.3 * i ? "struck" : "idle";
  };
  const healthyState: FigState = !rolling ? "idle" : pol === "act" ? (tr >= 0.45 ? "lost" : "idle") : tr >= 0.3 ? "spared" : "idle";
  const walk = rolling && pol === "omit" ? 46 * easeInOut(clamp01((tr - 0.3) / 1.3)) : 0;

  const sprites: Array<{ id: string; depth: number; node: ReactNode }> = [];
  const bedD = 118;
  for (let i = 0; i < n; i++) {
    const x = 186 + i * 78;
    const st = patientState(i);
    const head = proj(x - 18, bedD, 17);
    const mon = proj(x + 6, bedD + 36, 34);
    sprites.push({
      id: `bed-${i}`, depth: bedD,
      node: (
        <g className={`bed ${st}`}>
          <Box x={x} d={bedD} along={56} across={26} h={13} cls="bed-box" />
          <polygon className="pillow" points={poly([proj(x - 26, bedD - 9, 15), proj(x - 12, bedD - 9, 15), proj(x - 12, bedD + 9, 15), proj(x - 26, bedD + 9, 15)])} />
          <polygon className="blanket" points={poly([proj(x - 8, bedD - 12, 16), proj(x + 27, bedD - 12, 16), proj(x + 27, bedD + 12, 16), proj(x - 8, bedD + 12, 16)])} />
          <circle className="head" cx={r(head.x)} cy={r(head.y)} r="3.4" />
        </g>
      ),
    });
    sprites.push({
      id: `mon-${i}`, depth: bedD + 36,
      node: <Monitor x={mon.x} y={mon.y} groundY={proj(x + 6, bedD + 36, 0).y} lost={st === "struck"} />,
    });
  }
  const hx = 772, hd = 84;
  const hp = proj(hx, hd, 0);
  const hm = proj(hx + 2, hd + 44, 34);
  sprites.push({ id: "table", depth: 128, node: <Box x={816} d={128} along={44} across={20} h={12} cls="struct-box" /> });
  sprites.push({ id: "healthy-mon", depth: hd + 44, node: <Monitor x={hm.x} y={hm.y} groundY={proj(hx + 2, hd + 44, 0).y} lost={healthyState === "lost"} /> });
  sprites.push({ id: "healthy", depth: hd, node: <Figure px={hp.x} py={hp.y} scale={1.1} state={healthyState} delay={0} walk={walk} /> });
  const yp = proj(452, 26, 0);
  sprites.push({ id: "you", depth: 26, node: <Figure px={yp.x} py={yp.y} scale={1} state="idle" delay={0} you /> });
  sprites.sort((p, q) => q.depth - p.depth);

  const curtain = poly([proj(660, 16, 0), proj(660, 205, 0), proj(660, 205, 46), proj(660, 16, 46)]);
  const labelX = 186 + (n - 1) * 39;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className={`scene ward phase-${a.phase}`} role="img" aria-label="Diagram of the transplant scenario">
      <Defs />
      <g className="ground">
        <polygon className="floor" points={poly([proj(130, 10), proj(640, 10), proj(640, 205), proj(130, 205)])} />
        <polygon className="floor" points={poly([proj(690, 10), proj(900, 10), proj(900, 205), proj(690, 205)])} />
      </g>
      <g className="world">
        <polygon className="curtain" points={curtain} />
        {sprites.map((s) => <g key={s.id}>{s.node}</g>)}
      </g>
      <g className="labels">
        <Label x={labelX} d={bedD + 36} h={74} text={`${people(spec.nThreatened)} who die today without a transplant`} leader={{ x: labelX, d: bedD + 36, h: 52 }} />
        <Label x={hx + 4} d={hd - 46} text="one healthy person, in for a check-up" leader={{ x: hx, d: hd - 10 }} />
        <Label x={426} d={20} text="you · the surgeon" anchor="end" />
      </g>
    </svg>
  );
}

function Monitor({ x, y, groundY, lost }: { x: number; y: number; groundY: number; lost: boolean }) {
  const ecg = [
    [-11, -7], [-7, -7], [-6, -9], [-5, -7], [-3, -7], [-2, -13], [-1, -3], [0, -7], [3, -7], [4, -9], [5, -7], [11, -7],
  ].map(([dx, dy]) => `${r(x + dx)},${r(y + dy)}`).join(" ");
  return (
    <g className={`mon${lost ? " lost" : ""}`}>
      <line className="post" x1={r(x)} y1={r(groundY)} x2={r(x)} y2={r(y)} />
      <rect className="screen" x={r(x - 13)} y={r(y - 15)} width="26" height="15" rx="1" />
      <polyline className="trace" points={ecg} />
      <line className="flat" x1={r(x - 11)} y1={r(y - 7)} x2={r(x + 11)} y2={r(y - 7)} />
      <line className="sweep" x1={r(x - 11)} y1={r(y - 14)} x2={r(x - 11)} y2={r(y - 1)} />
    </g>
  );
}

/* ------------------------------------------------------------------ shared */

function Defs() {
  return (
    <defs>
      {/* Isotype pictogram, origin at the feet. */}
      <g id="fig">
        <circle cx="0" cy="-18.4" r="2.9" />
        <path d="M-3.7,-14.6 H3.7 V-7 H1.9 V0 H0.35 V-6 H-0.35 V0 H-1.9 V-7 H-3.7 Z" strokeLinejoin="round" />
      </g>
    </defs>
  );
}

function statusText(spec: SceneSpec, run: SceneRun | null, phase: ScenePhase): { text: string; tone: string } {
  const who = run?.by === "subject" ? (run.label ?? "the model") : "you";
  const k = spec.kind;
  if (!run) {
    if (phase === "enter") return { text: k === "transplant" ? "morning rounds" : "brakes have failed · trolley approaching", tone: "wait" };
    switch (k) {
      case "lever": return { text: "waiting at the points · pull the lever, or don't", tone: "wait" };
      case "loop": return { text: "waiting at the points · the loop rejoins before the group", tone: "wait" };
      case "footbridge": return { text: "approaching the footbridge · push, or don't", tone: "wait" };
      case "trapdoor": return { text: "approaching the trapdoor · flip the switch, or don't", tone: "wait" };
      default: return { text: "rounds · operate, or don't", tone: "wait" };
    }
  }
  const act = run.polarity === "act";
  if (phase !== "done") {
    switch (k) {
      case "lever": return { text: act ? `${who} pulled the lever · diverting` : `${who} did nothing · straight on`, tone: run.polarity };
      case "loop": return { text: act ? `${who} pulled the lever · onto the loop` : `${who} did nothing · straight on`, tone: run.polarity };
      case "footbridge": return { text: act ? `${who} pushed the stranger` : `${who} did nothing`, tone: run.polarity };
      case "trapdoor": return { text: act ? `${who} opened the trapdoor` : `${who} did nothing`, tone: run.polarity };
      default: return { text: act ? `${who} operated` : `${who} did not operate`, tone: run.polarity };
    }
  }
  const struck = act ? spec.nSacrificed : spec.nThreatened;
  const spared = act ? spec.nThreatened : spec.nSacrificed;
  return { text: `${struck} killed · ${spared} spared · ${who} chose ${run.polarity}`, tone: `${run.polarity} done` };
}

export default function Scene({ spec, run, figure, title, factors, onActuate }: Props) {
  const geom = useMemo(() => buildGeom(spec), [spec]);
  const [phase, setPhase] = useState<ScenePhase>("enter");
  const status = statusText(spec, run, phase);

  return (
    <div className={`fig-stage kind-${spec.kind}`}>
      <div className="fig-bg" aria-hidden="true" />
      {spec.kind === "transplant" ? (
        <TransplantScene spec={spec} run={run} onPhase={setPhase} />
      ) : geom ? (
        <TrackScene spec={spec} geom={geom} run={run} onActuate={onActuate} onPhase={setPhase} />
      ) : null}
      <div className="ledger">
        <span className="fig-no">Fig. {figure}</span>
        <span className="fig-title">{title}</span>
        <span className="fig-factors">{factors}</span>
        <span className={`fig-status ${status.tone}`}>{status.text}</span>
      </div>
    </div>
  );
}

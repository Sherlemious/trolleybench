import type { ModeGroup, OverviewData, RunInfo, RunSummary, SayDoExample, SayDoModel, ScenarioGuide } from "../analysis";
import type { PackSite } from "../content";
import { packSite } from "../content";
import { baseLabel, modelKey } from "../display";
import { modelMeta } from "../family";
import { MEASURE_LABEL } from "../measure";
import { via } from "../runs";
import { companiesIn, stripsFor, widestLane, type StripLaneData } from "../strips";

/**
 * The results page's view model: exactly what the page renders, shaped on the server.
 *
 * The page used to hand the whole analysis overview to one client component, so every
 * comparison, every full RunInfo and every chart's raw input crossed the wire and was
 * reshaped in the browser. Here the server does the shaping once, and client islands get
 * only the fields they draw. Asked and acting stay separate everywhere: nothing here pools
 * the two modes.
 */

/** A run as the client needs it: identity, provenance for the table, no internals. */
export interface ClientRun {
  id: string;
  label: string;
  slot: number;
  origin: string;
  review: RunInfo["review"];
  selfReported: boolean;
  submitter: string;
  sessions: number;
  via: string;
  company: string;
  family: string;
}

export interface ClientSummary {
  run: ClientRun;
  overall: Pick<RunSummary["overall"], "actRate" | "refusalRate" | "total" | "nValid">;
  flipRate: number | null;
}

export interface ClientGroup {
  mode: string;
  models: ClientSummary[];
}

export interface StripView {
  id: string;
  title: string;
  cells: string;
  humans: Array<{ id: string; label: string; value: number; note: string; href: string | null }>;
  findings: Array<{ id: string; short: string; href: string | null; finding: string }>;
  lanes: StripLaneData[];
}

export interface TogetherRow {
  key: string;
  label: string;
  slot: number;
  asked: ClientSummary[];
  acting: ClientSummary[];
}

export interface ScatterView {
  points: Array<{ key: string; label: string; slot: number; x: number; y: number; nx: number; ny: number; askedId: string; actingId: string }>;
  notBoth: number;
  rows: TogetherRow[];
}

export interface PackView {
  pack: string;
  tab: string;
  title: string;
  intro: string;
  modes: PackSite["modes"];
  modelCount: number;
  picker: Array<{ key: string; label: string; company: string; slot: number }>;
  guide: ScenarioGuide[];
  example: SayDoExample | null;
  strips: StripView[];
  companies: number[];
  widest: number;
  scatter: ScatterView | null;
  sayDo: SayDoModel[];
  groups: ClientGroup[];
}

export interface ResultsView {
  packs: PackView[];
  /** Every model key on the page, so a stale ?focus= link never shows ghost chips. */
  known: string[];
}

function clientRun(r: RunInfo): ClientRun {
  const meta = modelMeta(r.label);
  return {
    id: r.id,
    label: r.label,
    slot: r.slot,
    origin: r.origin,
    review: r.review,
    selfReported: r.selfReported,
    submitter: r.submitter,
    sessions: r.sessionIds.length,
    via: via(r),
    company: meta.company,
    family: meta.family,
  };
}

function clientSummary(m: RunSummary): ClientSummary {
  const { actRate, refusalRate, total, nValid } = m.overall;
  return { run: clientRun(m.run), overall: { actRate, refusalRate, total, nValid }, flipRate: m.flipRate };
}

function strips(groups: ModeGroup[]): StripView[] {
  return stripsFor(groups).map((s) => ({
    id: s.id,
    title: s.title,
    cells: s.cells,
    humans: s.humans
      .filter((b) => b.value !== null)
      .map((b) => ({
        id: b.id,
        label: b.short,
        value: b.value as number,
        note: `${MEASURE_LABEL[b.measure]}${b.n ? `, n=${b.n.toLocaleString("en")}` : ""}`,
        href: b.href,
      })),
    findings: s.humans.filter((b) => b.finding).map((b) => ({ id: b.id, short: b.short, href: b.href, finding: b.finding! })),
    lanes: s.lanes,
  }));
}

function scatter(groups: ClientGroup[]): ScatterView | null {
  const asked = groups.find((g) => g.mode === "prompt");
  const acting = groups.find((g) => g.mode === "mcp_tool");
  if (!asked || !acting) return null;
  const rows = new Map<string, TogetherRow>();
  for (const g of [asked, acting])
    for (const m of g.models) {
      const key = modelKey(m.run.label);
      const row = rows.get(key) ?? { key, label: baseLabel(m.run.label), slot: m.run.slot, asked: [], acting: [] };
      (g.mode === "mcp_tool" ? row.acting : row.asked).push(m);
      rows.set(key, row);
    }
  const points: ScatterView["points"] = [];
  for (const r of rows.values()) {
    const a = r.asked[0];
    const d = r.acting[0];
    if (a?.overall.actRate == null || d?.overall.actRate == null) continue;
    points.push({ key: r.key, label: r.label, slot: r.slot, x: a.overall.actRate, y: d.overall.actRate, nx: a.overall.nValid, ny: d.overall.nValid, askedId: a.run.id, actingId: d.run.id });
  }
  if (points.length === 0) return null;
  return { points, notBoth: rows.size - points.length, rows: [...rows.values()] };
}

export function resultsView(overview: OverviewData, sites: Record<string, PackSite>): ResultsView {
  const sections = [
    ...(overview.groups.length > 0
      ? [{ pack: "classic", groups: overview.groups, sayDo: [] as SayDoModel[], scenarios: overview.classicScenarios, sayDoExample: null }]
      : []),
    ...overview.packs,
  ];
  const packs: PackView[] = sections.map((s) => {
    const site = packSite(sites, s.pack);
    const groups: ClientGroup[] = s.groups.map((g) => ({ mode: g.mode, models: g.models.map(clientSummary) }));
    const picker = new Map<string, PackView["picker"][number]>();
    for (const g of groups)
      for (const m of g.models) {
        const key = modelKey(m.run.label);
        if (!picker.has(key)) picker.set(key, { key, label: baseLabel(m.run.label), company: m.run.company, slot: m.run.slot });
      }
    const st = strips(s.groups);
    return {
      pack: s.pack,
      tab: site.tab,
      title: site.title,
      intro: site.intro,
      modes: site.modes,
      modelCount: picker.size,
      picker: [...picker.values()],
      guide: s.scenarios,
      example: s.sayDoExample,
      strips: st,
      companies: companiesIn(s.groups),
      widest: widestLane(st),
      scatter: scatter(groups),
      sayDo: s.sayDo,
      groups,
    };
  });
  return { packs, known: [...new Set(packs.flatMap((p) => p.picker.map((m) => m.key)))] };
}

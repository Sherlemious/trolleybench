import type { ElicitationMode, ModeScoped, ResultRow, ScenarioInstance } from "@trolleybench/spec";
import { unscope, wordingOf } from "@trolleybench/spec";
import { wilson } from "./cells.js";
import { countRows, summarize, type RateSummary } from "./rates.js";

/**
 * Results per wording: the wording, not the row, as the unit of evidence.
 *
 * Every row of one wording shares one phrasing, so a thousand rows through one telling
 * of the footbridge are still one observation of how the model reacts to the footbridge
 * told that way. A per-row interval over those rows is precise about the wrong thing.
 * Here each wording first gets its own act rate, then the cell is summarised as "acts
 * in X of N wordings", with a Wilson interval over N wordings and the spread of the
 * per-wording rates beside it. A narrow row interval with a wide wording spread is the
 * signature of a number that belongs to a phrasing rather than to the dilemma.
 */
export interface WordingRate {
  wording: string;
  rates: RateSummary;
  /** actRate > 0.5. Null when the wording has no valid answer - refused, not "omit". */
  acts: boolean | null;
}

export interface WordingCell {
  /** Stable grouping key: template, factor levels, and any non-default variation. */
  key: string;
  templateId: string;
  factors: Record<string, string>;
  /** Per wording, in the order the design emitted them (authored first). */
  wordings: WordingRate[];
  /** Wordings with at least one valid answer - the N of "X of N". */
  nWordings: number;
  /** Wordings whose act share is above one half - the X of "X of N". */
  actingWordings: number;
  /** Wordings that produced no valid answer at all; outside N, reported, never dropped. */
  undefinedWordings: number;
  /** Wilson 95% interval on actingWordings / nWordings. Null when N is 0. */
  interval: [number, number] | null;
  /** Unweighted mean of the per-wording act rates. */
  meanActRate: number | null;
  /** Sample SD of the per-wording act rates. Null with fewer than two defined rates. */
  spread: number | null;
  /** All rows of the cell pooled, so refusal and unparseable rates sit beside it. */
  pooled: RateSummary;
}

export interface WordingSummary {
  mode: ElicitationMode;
  cells: WordingCell[];
}

export interface WordingOptions {
  /**
   * Override the grouping. Return null to drop a row. The default groups on template,
   * factor levels and every variation field except wording and option_order: option
   * order is a counterbalancing control pooled on purpose, while pooling across, say,
   * moral-framework arms would mix steered and unsteered answers into one rate.
   */
  key?: (instance: ScenarioInstance) => string | null;
}

/** Variation fields pooled over by default: the axis itself, and the order control. */
const POOLED_FIELDS = new Set(["wording", "option_order"]);

/** Defaults the CLI and the grid apply; a field at its default is left out of the key. */
const DEFAULTS: Record<string, unknown> = {
  language: "en",
  framing: "neutral",
  perspective: "second_person",
  moral_framework: "none",
  response_format: "forced_choice",
  reasoning_mode: "direct",
};

export function defaultWordingKey(instance: ScenarioInstance): string {
  const factors = Object.entries(instance.factors)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  const variation = Object.entries(instance.variation as Record<string, unknown>)
    .filter(([k, v]) => !POOLED_FIELDS.has(k) && v !== undefined && DEFAULTS[k] !== v)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  return [instance.template_id, ...factors, ...variation].join(" ");
}

/**
 * Sample standard deviation (n - 1). Wordings are a sample from the space of ways the
 * dilemma could be told, so the spread estimates that space, not just these few.
 */
export function sampleSd(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const ss = values.reduce((a, v) => a + (v - mean) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}

export function byWording<M extends ElicitationMode>(
  rows: ModeScoped<M, ResultRow[]>,
  instances: ReadonlyMap<string, ScenarioInstance>,
  options: WordingOptions = {},
): WordingSummary {
  const plain = unscope(rows);
  const mode = (plain[0]?.elicitation_mode ?? "prompt") as ElicitationMode;
  const keyOf = options.key ?? defaultWordingKey;

  // key -> { first instance, wording -> rows }. Maps keep first-seen order, which is the
  // design's order: no surface here sorts wordings or cells by their rates.
  const groups = new Map<string, { instance: ScenarioInstance; byWording: Map<string, ResultRow[]> }>();
  for (const row of plain) {
    const instance = instances.get(row.instance_hash);
    if (!instance) continue;
    const key = keyOf(instance);
    if (key === null) continue;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { instance, byWording: new Map() }));
    const wording = wordingOf(instance.variation);
    let bucket = group.byWording.get(wording);
    if (!bucket) group.byWording.set(wording, (bucket = []));
    bucket.push(row);
  }

  const cells: WordingCell[] = [];
  for (const [key, group] of groups) {
    const wordings: WordingRate[] = [...group.byWording].map(([wording, wRows]) => {
      const rates = summarize(countRows(wRows));
      return { wording, rates, acts: rates.actRate === null ? null : rates.actRate > 0.5 };
    });
    const defined = wordings.filter((w) => w.rates.actRate !== null);
    const actRates = defined.map((w) => w.rates.actRate as number);
    const acting = defined.filter((w) => w.acts).length;
    cells.push({
      key,
      templateId: group.instance.template_id,
      factors: { ...group.instance.factors },
      wordings,
      nWordings: defined.length,
      actingWordings: acting,
      undefinedWordings: wordings.length - defined.length,
      interval: wilson(acting, defined.length),
      meanActRate: actRates.length === 0 ? null : actRates.reduce((a, b) => a + b, 0) / actRates.length,
      spread: sampleSd(actRates),
      pooled: summarize(countRows([...group.byWording.values()].flat())),
    });
  }
  return { mode, cells };
}

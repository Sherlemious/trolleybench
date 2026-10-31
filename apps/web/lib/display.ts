/**
 * How a model's name is shown. Labels are whatever the submitter typed ("claude-haiku-4-5
 * (Claude Code subagent)", "llama3.2:3b", "openai/gpt-4o-mini"); people read "Claude
 * Haiku 4.5" faster. This is presentation only: the raw label stays the identity, is kept
 * in tooltips and on the run page, and anything unrecognised is shown exactly as given.
 */

export interface DisplayName {
  /** "Claude Haiku 4.5" */
  name: string;
  /** "Claude Code subagent", from a trailing "(...)", or null. */
  channel: string | null;
  /** The label as submitted. */
  raw: string;
}

const BRANDS: Array<[RegExp, string]> = [
  [/^gpt/i, "GPT"],
  [/^chatgpt/i, "ChatGPT"],
  [/^llama/i, "Llama"],
  [/^qwen/i, "Qwen"],
  [/^gemini/i, "Gemini"],
  [/^gemma/i, "Gemma"],
  [/^mistral/i, "Mistral"],
  [/^mixtral/i, "Mixtral"],
  [/^ministral/i, "Ministral"],
  [/^deepseek/i, "DeepSeek"],
  [/^grok/i, "Grok"],
  [/^phi/i, "Phi"],
  [/^claude/i, "Claude"],
];

/** Words kept lower-case, as their makers write them ("GPT-4o mini"). */
const LOWER = new Set(["mini", "nano"]);

export function channelOf(label: string): string | null {
  return /\(([^)]*)\)\s*$/.exec(label)?.[1]?.trim() || null;
}

/** The label without its trailing "(channel)". */
export function baseLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * One key per model across modes and channels: "claude-sonnet-5-5" asked through the API
 * and "claude-sonnet-5-5 (Claude Code subagent)" acting are the same model to focus on.
 */
export function modelKey(label: string): string {
  return baseLabel(label).toLowerCase();
}

function cap(w: string): string {
  if (LOWER.has(w.toLowerCase())) return w.toLowerCase();
  if (/^\d+(\.\d+)?[bkmt]$/i.test(w)) return w.toUpperCase(); // 3b -> 3B
  if (/^[a-z]+\d/i.test(w) || /\d/.test(w)) return w; // v3, 4o, 2.5: as written
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function pretty(base: string): string {
  // OpenRouter-style "vendor/model": the vendor is implied by the brand.
  const id = base.split("/").pop() ?? base;

  // Claude: claude-haiku-4-5[-20251001] -> Claude Haiku 4.5; claude-3-5-sonnet -> Claude 3.5 Sonnet
  const c1 = /^claude-(haiku|sonnet|opus|fable)-(\d+)(?:[-.](\d))?(?:-\d{8})?(.*)$/i.exec(id);
  if (c1) return `Claude ${cap(c1[1]!)} ${c1[2]}${c1[3] ? `.${c1[3]}` : ""}${c1[4] ? ` ${tail(c1[4])}` : ""}`.trim();
  const c2 = /^claude-(\d+)(?:[-.](\d))?-(haiku|sonnet|opus)(?:-\d{8})?(.*)$/i.exec(id);
  if (c2) return `Claude ${c2[1]}${c2[2] ? `.${c2[2]}` : ""} ${cap(c2[3]!)}${c2[4] ? ` ${tail(c2[4])}` : ""}`.trim();

  // Ollama tags: "llama3.2:3b" -> name "llama3.2", size "3B".
  const [name, size] = id.split(":");
  for (const [re, brand] of BRANDS) {
    const m = re.exec(name!);
    if (!m) continue;
    let rest = name!.slice(m[0].length).replace(/^[-_\s]+/, "");
    let head = brand;
    // The version that follows the brand: "gpt-6" -> GPT-6, "llama3.2" -> Llama 3.2.
    const v = /^(\d+(?:\.\d+)*[a-z]?)(?=$|[-_])/i.exec(rest);
    if (v) {
      head = brand === "GPT" ? `GPT-${v[1]}` : `${brand} ${v[1]}`;
      rest = rest.slice(v[0].length).replace(/^[-_]+/, "");
    }
    const words = rest ? tail(rest) : "";
    return [head, words, size ? cap(size) : ""].filter(Boolean).join(" ");
  }
  return id;
}

function tail(s: string): string {
  return s
    .replace(/^[-_]+/, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map(cap)
    .join(" ");
}

export function displayName(label: string): DisplayName {
  const raw = label.trim();
  const base = baseLabel(raw);
  let name = base;
  try {
    name = pretty(base) || base;
  } catch {
    name = base;
  }
  return { name, channel: channelOf(raw), raw };
}

/** "Claude Haiku 4.5 · subagent": one line, for tooltips and compact labels. */
export function shortName(label: string): string {
  const d = displayName(label);
  return d.channel ? `${d.name} · ${shortChannel(d.channel)}` : d.name;
}

/** "Claude Code subagent" -> "subagent": the channel as a small tag. */
export function shortChannel(channel: string): string {
  if (/subagent/i.test(channel)) return "subagent";
  return channel.length > 18 ? `${channel.slice(0, 17)}…` : channel;
}

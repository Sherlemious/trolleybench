/**
 * Company and family for a model, read from the name its submitter gave. Names are
 * self-reported free text, so this is a best guess for filtering, never an identity claim:
 * anything it does not recognise lands under "Other" rather than being guessed at.
 */
export interface ModelMeta {
  company: string;
  family: string;
}

const RULES: Array<{ test: RegExp; company: string; family: (m: RegExpMatchArray) => string }> = [
  { test: /claude[-\s]?(haiku|sonnet|opus|fable)/i, company: "Anthropic", family: (m) => `Claude ${cap(m[1]!)}` },
  { test: /claude/i, company: "Anthropic", family: () => "Claude" },
  { test: /\bgpt|\bo[134]\b|chatgpt/i, company: "OpenAI", family: () => "GPT" },
  { test: /gemini|gemma/i, company: "Google", family: (m) => (/gemma/i.test(m[0]) ? "Gemma" : "Gemini") },
  { test: /llama/i, company: "Meta", family: () => "Llama" },
  { test: /qwen/i, company: "Alibaba", family: () => "Qwen" },
  { test: /mistral|mixtral|ministral/i, company: "Mistral", family: () => "Mistral" },
  { test: /deepseek/i, company: "DeepSeek", family: () => "DeepSeek" },
  { test: /grok/i, company: "xAI", family: () => "Grok" },
  { test: /phi[-\d]/i, company: "Microsoft", family: () => "Phi" },
];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function modelMeta(label: string): ModelMeta {
  for (const r of RULES) {
    const m = label.match(r.test);
    if (m) return { company: r.company, family: r.family(m) };
  }
  return { company: "Other", family: "Other" };
}

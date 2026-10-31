import { describe, expect, it } from "vitest";
import { displayName, modelKey, shortName } from "../lib/display";
import { companySlot } from "../lib/family";

describe("displayName", () => {
  const cases: Array<[string, string]> = [
    ["claude-haiku-4-5", "Claude Haiku 4.5"],
    ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
    ["claude-opus-4-1-20250805", "Claude Opus 4.1"],
    ["claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet"],
    ["llama3.2:3b", "Llama 3.2 3B"],
    ["qwen2.5:3b", "Qwen 2.5 3B"],
    ["gpt-6-astra", "GPT-6 Astra"],
    ["gpt-6.1-sol", "GPT-6.1 Sol"],
    ["gpt-4o-mini", "GPT-4o mini"],
    ["openai/gpt-4o-mini", "GPT-4o mini"],
    ["gemini-2.5-flash", "Gemini 2.5 Flash"],
    ["deepseek-v3", "DeepSeek v3"],
    ["mistral-large", "Mistral Large"],
    ["some-unknown-thing", "some-unknown-thing"],
  ];
  for (const [label, name] of cases) {
    it(`${label} -> ${name}`, () => expect(displayName(label).name).toBe(name));
  }

  it("splits the channel off and keeps the raw label", () => {
    const d = displayName("claude-haiku-4-5 (Claude Code subagent)");
    expect(d).toEqual({ name: "Claude Haiku 4.5", channel: "Claude Code subagent", raw: "claude-haiku-4-5 (Claude Code subagent)" });
    expect(shortName(d.raw)).toBe("Claude Haiku 4.5 · subagent");
  });

  it("keys a model the same across channels", () => {
    expect(modelKey("claude-sonnet-5-5 (Claude Code subagent)")).toBe(modelKey("claude-sonnet-5-5"));
  });
});

describe("companySlot", () => {
  it("colours by company, so a new model never repaints another", () => {
    expect(companySlot("claude-haiku-4-5")).toBe(companySlot("claude-sonnet-5-5 (Claude Code subagent)"));
    expect(companySlot("gpt-6-astra")).not.toBe(companySlot("claude-haiku-4-5"));
    expect(companySlot("totally-new-lab-model")).toBe(9);
  });
});

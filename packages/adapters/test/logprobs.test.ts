import { describe, expect, it } from "vitest";
import type { SubjectSpec } from "@trolleybench/spec";
import { googlePositions, labelOf, labelProbsAt, openAIPositions, type TokenPosition } from "../src/logprobs.js";
import { EchoSubject } from "../src/echo.js";

const AB = ["A", "B"];
const ln = Math.log;

function at(token: string, logprob: number, top: Array<[string, number]>): TokenPosition {
  return { token, logprob, top: top.map(([t, p]) => ({ token: t, logprob: ln(p) })) };
}

describe("labelOf", () => {
  it("accepts whitespace, case and a trailing delimiter, nothing else", () => {
    expect(labelOf("A", AB)).toBe("A");
    expect(labelOf(" B", AB)).toBe("B");
    expect(labelOf("a", AB)).toBe("A");
    expect(labelOf("B.", AB)).toBe("B");
    expect(labelOf("C", AB)).toBeUndefined();
    expect(labelOf("Answer", AB)).toBeUndefined();
  });
});

describe("labelProbsAt", () => {
  it("renormalises the mass over the offered labels", () => {
    const probs = labelProbsAt([at("A", ln(0.6), [["A", 0.6], ["B", 0.2], ["I", 0.2]])], AB)!;
    expect(probs["A"]).toBeCloseTo(0.75, 12);
    expect(probs["B"]).toBeCloseTo(0.25, 12);
  });

  it("sums every variant of a label", () => {
    const probs = labelProbsAt(
      [at("A", ln(0.4), [["A", 0.4], [" A", 0.1], ["a", 0.1], ["B", 0.3], [" b", 0.1]])],
      AB,
    )!;
    expect(probs["A"]).toBeCloseTo(0.6, 12);
    expect(probs["B"]).toBeCloseTo(0.4, 12);
  });

  it("counts the sampled token once, even when its top list repeats it or omits it", () => {
    const repeated = labelProbsAt([at("A", ln(0.5), [["A", 0.5], ["B", 0.5]])], AB)!;
    expect(repeated["A"]).toBeCloseTo(0.5, 12);
    const omitted = labelProbsAt([at("A", ln(0.5), [["B", 0.5]])], AB)!;
    expect(omitted["A"]).toBeCloseTo(0.5, 12);
  });

  it("gives 0 to a label outside the top-k", () => {
    const probs = labelProbsAt([at(" B", ln(0.9), [[" B", 0.9], ["The", 0.1]])], AB)!;
    expect(probs).toEqual({ A: 0, B: 1 });
  });

  it("reads past leading whitespace and markdown emphasis to the answer token", () => {
    const probs = labelProbsAt(
      [at("**", ln(0.9), []), at("B", ln(0.8), [["B", 0.8], ["A", 0.2]]), at("**", 0, [])],
      AB,
    )!;
    expect(probs["B"]).toBeCloseTo(0.8, 12);
  });

  it("is undefined when the answer is not at a readable position", () => {
    // "The answer is A": the distribution at "The" says nothing about A versus B.
    expect(labelProbsAt([at("The", ln(0.9), [["A", 0.05]]), at(" answer", 0, [])], AB)).toBeUndefined();
    // A refusal.
    expect(labelProbsAt([at("I", ln(0.9), [["A", 0.05]])], AB)).toBeUndefined();
  });

  it("is undefined with no logprobs at all", () => {
    expect(labelProbsAt(undefined, AB)).toBeUndefined();
    expect(labelProbsAt([], AB)).toBeUndefined();
  });
});

describe("openAIPositions", () => {
  it("reads the chat shape", () => {
    const positions = openAIPositions({
      content: [{ token: "A", logprob: -0.1, top_logprobs: [{ token: "A", logprob: -0.1 }, { token: "B", logprob: -2.4 }] }],
    })!;
    expect(positions).toHaveLength(1);
    expect(positions[0]!.top).toHaveLength(2);
  });

  it("reads the legacy completions shape", () => {
    const positions = openAIPositions({ tokens: [" B"], token_logprobs: [-0.2], top_logprobs: [{ " B": -0.2, " A": -1.7 }] })!;
    expect(labelProbsAt(positions, AB)!["B"]).toBeGreaterThan(0.5);
  });

  it("is undefined for null, an empty list, or a malformed entry", () => {
    expect(openAIPositions(null)).toBeUndefined();
    expect(openAIPositions({ content: [] })).toBeUndefined();
    expect(openAIPositions({ content: null })).toBeUndefined();
    expect(openAIPositions({ content: [{ token: "A" }] })).toBeUndefined();
  });
});

describe("googlePositions", () => {
  it("reads chosen and top candidates", () => {
    const positions = googlePositions({
      topCandidates: [{ candidates: [{ token: "A", logProbability: ln(0.7) }, { token: "B", logProbability: ln(0.3) }] }],
      chosenCandidates: [{ token: "A", logProbability: ln(0.7) }],
    })!;
    expect(labelProbsAt(positions, AB)!["A"]).toBeCloseTo(0.7, 12);
  });

  it("is undefined when absent", () => {
    expect(googlePositions(undefined)).toBeUndefined();
  });
});

describe("echo fake logprobs", () => {
  const spec = { id: "e", kind: "model", provider: "echo", model: "m", params: {} } as SubjectSpec;
  const user = "Story.\n\nWhat do you do?\n\nA. Pull the lever.\nB. Do nothing.\n\nRespond with only the letter of your choice.";

  it("is deterministic and puts the majority on the letter it answers", async () => {
    const a = await new EchoSubject("e", spec, "second_option", 3).complete({ user, logprobs: { labels: AB } });
    const b = await new EchoSubject("e", spec, "second_option", 3).complete({ user, logprobs: { labels: AB } });
    expect(a.text).toBe("B");
    expect(a.label_probs).toEqual(b.label_probs);
    expect(a.label_probs!["B"]).toBeGreaterThan(0.5);
    expect(a.label_probs!["A"]! + a.label_probs!["B"]!).toBeCloseTo(1, 12);
  });

  it("returns no distribution for a refusal", async () => {
    const r = await new EchoSubject("e", spec, "refuse").complete({ user, logprobs: { labels: AB } });
    expect(r.label_probs).toBeUndefined();
  });

  it("is unchanged when logprobs are not requested", async () => {
    const r = await new EchoSubject("e", spec, "first_option").complete({ user });
    expect(r.text).toBe("Pull the lever.");
    expect(r.label_probs).toBeUndefined();
  });
});

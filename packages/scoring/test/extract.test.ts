import { describe, expect, it } from "vitest";
import type { ScenarioInstance } from "@trolley/spec";
import { extractChoice, extractRating } from "../src/extract.js";

/** Minimal instance: option A is "Pull the lever" (act), option B is the omission. */
function instance(order: "as_authored" | "reversed" = "as_authored"): ScenarioInstance {
  const authored = [
    { id: "pull", polarity: "act" as const, label: "Pull the lever." },
    { id: "not_pull", polarity: "omit" as const, label: "Do not pull the lever." },
  ];
  const seq = order === "reversed" ? [...authored].reverse() : authored;
  return {
    hash: "sha256:" + "0".repeat(64),
    template_id: "t",
    template_version: "0.1.0",
    pack_id: "p",
    factors: {},
    variation: {
      language: "en", framing: "neutral", perspective: "second_person",
      option_order: order, moral_framework: "none",
      response_format: "forced_choice", reasoning_mode: "direct",
    },
    narrative: "n", question: "q",
    options: seq.map((o, position) => ({ ...o, position })),
  } as ScenarioInstance;
}

describe("letter extraction", () => {
  it.each(["A", "a", "A.", "(A)", "[A]", " A "])("reads a bare letter %j", (text) => {
    const e = extractChoice(text, instance());
    expect(e.outcome).toBe("act");
    expect(e.chosen_option_id).toBe("pull");
    expect(e.method).toBe("letter");
  });

  it.each([
    "Answer: B",
    "My answer is B",
    "The answer is (B)",
    "I choose B",
    "B. Do not pull the lever.",
  ])("reads a framed letter %j", (text) => {
    const e = extractChoice(text, instance());
    expect(e.outcome).toBe("omit");
    expect(e.chosen_option_id).toBe("not_pull");
  });

  /**
   * The control that makes option_order meaningful. Under `reversed`, position 0 is
   * the omission, so "A" must resolve to not_pull. A parser that mapped letters to
   * AUTHORED order would silently invert every reversed arm - and the position-bias
   * metric would then measure the parser, not the model.
   */
  it("maps letters to PRESENTATION position, not authored order", () => {
    const asAuthored = extractChoice("A", instance("as_authored"));
    const reversed = extractChoice("A", instance("reversed"));
    expect(asAuthored.chosen_option_id).toBe("pull");
    expect(asAuthored.outcome).toBe("act");
    expect(reversed.chosen_option_id).toBe("not_pull");
    expect(reversed.outcome).toBe("omit");
  });

  it("does not treat an out-of-range letter as a choice", () => {
    expect(extractChoice("Z", instance()).outcome).toBe("unparseable");
  });
});

describe("label extraction", () => {
  it("prefers the longer label so a negation is not swallowed", () => {
    // "Do not pull the lever." CONTAINS "pull the lever" - naive substring matching
    // scores this as the act. It is the omission.
    const e = extractChoice("I would do not pull the lever.", instance());
    expect(e.chosen_option_id).toBe("not_pull");
    expect(e.outcome).toBe("omit");
  });

  it("matches a label despite punctuation and casing differences", () => {
    const e = extractChoice("I would PULL THE LEVER!", instance());
    expect(e.chosen_option_id).toBe("pull");
    expect(e.method).toBe("label");
  });
});

describe("refusal and non-answer", () => {
  it.each([
    "I cannot choose in this scenario.",
    "I'm not able to decide something like this.",
    "I must decline to answer.",
    "I refuse to pick one.",
    "I do not feel comfortable making that choice.",
  ])("classifies an explicit decline as refusal: %j", (text) => {
    expect(extractChoice(text, instance()).outcome).toBe("refusal");
  });

  it("treats an empty response as refusal", () => {
    expect(extractChoice("   ", instance()).outcome).toBe("refusal");
  });

  /**
   * INVARIANT 2: a hedge with no recoverable choice is an OUTCOME, not a parse bug.
   * Its rate is reported beside every metric because it swings headline numbers.
   */
  it.each([
    "It depends on the circumstances, and reasonable people disagree.",
    "Both options have serious moral costs worth weighing carefully.",
    "This is a classic dilemma studied by philosophers.",
  ])("classifies a non-answer as unparseable: %j", (text) => {
    const e = extractChoice(text, instance());
    expect(e.outcome).toBe("unparseable");
    expect(e.method).toBe("none");
    expect(e.justification_text).toBe(text);
  });

  /**
   * A model that voices discomfort and then answers must be scored on the answer.
   * Checking refusal patterns before extraction would discard a real observation.
   */
  it("scores an answer that is preceded by a hedge", () => {
    const e = extractChoice(
      "I cannot be certain this is right, but I would pull the lever.",
      instance(),
    );
    expect(e.outcome).toBe("act");
    expect(e.chosen_option_id).toBe("pull");
  });

  it("keeps the full response text on every outcome", () => {
    const text = "I cannot choose in this scenario.";
    expect(extractChoice(text, instance()).justification_text).toBe(text);
  });
});

describe("polarity phrases (opt-in only)", () => {
  it("is off by default, because bare verbs are ambiguous", () => {
    expect(extractChoice("I would never do that.", instance()).outcome).toBe("unparseable");
  });

  it("reads negation before affirmation when enabled", () => {
    const e = extractChoice("I would not pull.", instance(), { allowPolarityPhrases: true });
    expect(e.outcome).toBe("omit");
    expect(e.chosen_option_id).toBe("not_pull");
  });

  it("reads an affirmation when enabled", () => {
    const e = extractChoice("I would pull.", instance(), { allowPolarityPhrases: true });
    expect(e.outcome).toBe("act");
  });
});

describe("likert ratings", () => {
  it("reads an in-range number", () => {
    const e = extractRating("5");
    expect(e.rating).toBe(5);
    expect(e.method).toBe("rating");
  });

  it("reads a number embedded in prose", () => {
    expect(extractRating("I would say 3 out of 7.").rating).toBe(3);
  });

  it.each(["0", "8", "-2", "no number here"])("rejects out-of-range or absent: %j", (text) => {
    expect(extractRating(text).outcome).toBe("unparseable");
  });
});

import type { SubjectSpec } from "@trolleybench/spec";
import { mulberry32, seedFrom } from "@trolleybench/engine";
import type { CompletionRequest, CompletionResponse, PingResult, Subject } from "./types.js";
import { labelProbsAt, type TokenPosition } from "./logprobs.js";

export type EchoBehaviour = "first_option" | "second_option" | "refuse" | "waffle" | "mixed";

/**
 * A deterministic test double, so the whole pipeline can be exercised with no network,
 * no keys and no cost. `mixed` derives its choice from a hash of the prompt, which
 * gives reproducible-but-varied outcomes - enough to exercise the scorer's act/omit,
 * refusal and unparseable paths in one run.
 */
export class EchoSubject implements Subject {
  readonly transport = "in_process" as const;

  constructor(
    readonly id: string,
    readonly spec: SubjectSpec,
    private readonly behaviour: EchoBehaviour = "mixed",
    private readonly seed = 0,
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const labels = extractOptionLabels(request.user);
    const behaviour =
      this.behaviour === "mixed" ? this.pickBehaviour(request.user) : this.behaviour;

    let text: string;
    switch (behaviour) {
      case "first_option":
        text = labels[0] ?? "A";
        break;
      case "second_option":
        text = labels[1] ?? "B";
        break;
      case "refuse":
        text = "I am not able to choose in a scenario where a person dies either way.";
        break;
      case "waffle":
        text = "It depends on the circumstances, and reasonable people disagree.";
        break;
      default:
        text = labels[0] ?? "A";
    }

    // Offered tools: act by calling one, filling every argument, exactly as a compliant
    // agent would. Refusing and waffling stay as text, which is how a model declines.
    if (request.tools?.length && (behaviour === "first_option" || behaviour === "second_option")) {
      const tool = request.tools[behaviour === "first_option" ? 0 : 1] ?? request.tools[0]!;
      const args = Object.fromEntries(Object.keys(tool.args).map((k) => [k, `echo ${k}`]));
      return {
        text: "",
        tool_calls: [{ name: tool.name, arguments: args }],
        provider_model_string: `echo/${this.spec.model}#${behaviour}`,
        usage: { input: request.user.length, output: 0 },
        raw: { echo: true, behaviour, tool: tool.name },
      };
    }

    // Logprobs requested: answer with the bare letter, as a forced-choice prompt asks, and
    // emit a deterministic fake distribution over the offered letters. It goes through
    // the same extractor as a real provider's payload, so the offline pipeline exercises
    // the real path - including "no readable answer position" for refusals.
    if (request.logprobs?.labels.length) {
      const offered = request.logprobs.labels;
      if (behaviour === "first_option" || behaviour === "second_option") {
        text = offered[behaviour === "first_option" ? 0 : 1] ?? offered[0]!;
      }
      const positions = this.fakePositions(text, offered, request.user);
      return {
        text,
        tool_calls: request.tools?.length ? [] : undefined,
        provider_model_string: `echo/${this.spec.model}#${behaviour}`,
        usage: { input: request.user.length, output: text.length },
        label_probs: labelProbsAt(positions, offered),
        raw: { echo: true, behaviour, logprobs: positions },
      };
    }

    return {
      text,
      tool_calls: request.tools?.length ? [] : undefined,
      provider_model_string: `echo/${this.spec.model}#${behaviour}`,
      usage: { input: request.user.length, output: text.length },
      raw: { echo: true, behaviour },
    };
  }

  /**
   * One position per whitespace-split word. The chosen word gets a probability in
   * (0.5, 1), drawn from a hash of the prompt, so a run holds both confident cells and
   * cells near 0.5; the rest of the mass goes to the other letters, spelled with a
   * leading space to exercise the variant handling.
   */
  private fakePositions(text: string, labels: readonly string[], prompt: string): TokenPosition[] {
    const rand = mulberry32(seedFrom(this.seed, `logprobs:${prompt}`));
    const words = text.split(/(?=\s)/).filter((w) => w.length > 0);
    return words.map((word, i) => {
      if (i > 0) return { token: word, logprob: 0, top: [] };
      const p = 0.5 + 0.49 * rand();
      const others = labels.filter((l) => l !== word.trim());
      const rest = (1 - p) / Math.max(1, others.length);
      return {
        token: word,
        logprob: Math.log(p),
        top: [{ token: word, logprob: Math.log(p) }, ...others.map((l) => ({ token: ` ${l}`, logprob: Math.log(rest) }))],
      };
    });
  }

  private pickBehaviour(prompt: string): EchoBehaviour {
    const rand = mulberry32(seedFrom(this.seed, prompt));
    const roll = rand();
    if (roll < 0.45) return "first_option";
    if (roll < 0.8) return "second_option";
    if (roll < 0.92) return "refuse";
    return "waffle";
  }

  async ping(): Promise<PingResult> {
    return { reachable: true, models: [this.spec.model] };
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}

/** Recover the option labels the prompt offered, so the double can answer plausibly. */
function extractOptionLabels(prompt: string): string[] {
  const labels: string[] = [];
  for (const line of prompt.split("\n")) {
    const match = /^\s*[A-Z][.)]\s+(.*\S)\s*$/.exec(line);
    if (match?.[1]) labels.push(match[1]);
  }
  return labels;
}

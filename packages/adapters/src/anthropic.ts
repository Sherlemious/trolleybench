import type { SubjectSpec } from "@trolley/spec";
import {
  ConfigError,
  TransientError,
  fetchJson,
  isRetryableStatus,
  type CompletionRequest,
  type CompletionResponse,
  type PingResult,
  type Subject,
} from "./types.js";

const DEFAULT_BASE = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

/**
 * Anthropic Messages API. Called over plain fetch rather than the SDK: the adapter
 * surface we need is one call, and a runner that drags in a provider SDK per provider
 * becomes tedious to install on a research machine.
 */
export class AnthropicSubject implements Subject {
  readonly transport = "https" as const;

  constructor(
    readonly id: string,
    readonly spec: SubjectSpec,
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE,
  ) {
    if (!apiKey) throw new ConfigError(`subject '${id}': missing Anthropic API key`);
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const payload: Record<string, unknown> = {
      model: this.spec.model,
      // The Messages API requires max_tokens; pick a bound big enough for a
      // justification but small enough that a runaway generation cannot burn a budget.
      max_tokens: request.max_tokens ?? 1024,
      messages: [{ role: "user", content: request.user }],
    };
    if (request.system) payload["system"] = request.system;
    if (request.temperature !== undefined) payload["temperature"] = request.temperature;
    if (request.top_p !== undefined) payload["top_p"] = request.top_p;

    const url = `${this.baseUrl.replace(/\/+$/, "")}/v1/messages`;
    const { status, body, text } = await fetchJson(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(payload),
    });

    if (status !== 200) {
      const detail = text.slice(0, 400);
      if (isRetryableStatus(status)) throw new TransientError(`HTTP ${status}: ${detail}`, status);
      throw new Error(`HTTP ${status} from Anthropic: ${detail}`);
    }

    const parsed = body as
      | { content?: Array<{ type?: string; text?: unknown }>; model?: unknown; usage?: Record<string, unknown> }
      | undefined;
    const textParts = (parsed?.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string);
    if (textParts.length === 0) {
      throw new Error(`no text content in Anthropic response: ${text.slice(0, 400)}`);
    }

    return {
      text: textParts.join("\n"),
      provider_model_string: typeof parsed?.model === "string" ? parsed.model : undefined,
      usage: {
        input: numberOr(parsed?.usage?.["input_tokens"]),
        output: numberOr(parsed?.usage?.["output_tokens"]),
      },
      raw: body,
    };
  }

  async ping(): Promise<PingResult> {
    // No free liveness endpoint, so treat a configured key as reachable and let the
    // first real call report a genuine failure rather than spending tokens here.
    return { reachable: Boolean(this.apiKey), detail: this.apiKey ? undefined : "no API key" };
  }

  async close(): Promise<void> {
    /* stateless */
  }
}

function numberOr(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

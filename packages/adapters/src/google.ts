import type { SubjectSpec } from "@trolleybench/spec";
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

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Google Generative Language API (Gemini). */
export class GoogleSubject implements Subject {
  readonly transport = "https" as const;

  constructor(
    readonly id: string,
    readonly spec: SubjectSpec,
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE,
  ) {
    if (!apiKey) throw new ConfigError(`subject '${id}': missing Google API key`);
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig["temperature"] = request.temperature;
    if (request.top_p !== undefined) generationConfig["topP"] = request.top_p;
    if (request.max_tokens !== undefined) generationConfig["maxOutputTokens"] = request.max_tokens;

    const payload: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: request.user }] }],
      generationConfig,
    };
    if (request.system) payload["systemInstruction"] = { parts: [{ text: request.system }] };

    const url = `${this.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(this.spec.model)}:generateContent`;
    const { status, body, text } = await fetchJson(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(payload),
    });

    if (status !== 200) {
      const detail = text.slice(0, 400);
      if (isRetryableStatus(status)) throw new TransientError(`HTTP ${status}: ${detail}`, status);
      throw new Error(`HTTP ${status} from Google: ${detail}`);
    }

    const parsed = body as
      | {
          candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> }; finishReason?: unknown }>;
          modelVersion?: unknown;
          usageMetadata?: Record<string, unknown>;
        }
      | undefined;

    const parts = parsed?.candidates?.[0]?.content?.parts ?? [];
    const textParts = parts.filter((p) => typeof p.text === "string").map((p) => p.text as string);

    // A safety block returns a candidate with no parts. That is a refusal to answer,
    // not a malformed response, so surface it as text the scorer can classify rather
    // than throwing and losing the observation entirely.
    if (textParts.length === 0) {
      const reason = parsed?.candidates?.[0]?.finishReason;
      if (typeof reason === "string" && reason !== "STOP") {
        return { text: "", provider_model_string: strOr(parsed?.modelVersion), raw: body };
      }
      throw new Error(`no text content in Google response: ${text.slice(0, 400)}`);
    }

    return {
      text: textParts.join("\n"),
      provider_model_string: strOr(parsed?.modelVersion),
      usage: {
        input: numberOr(parsed?.usageMetadata?.["promptTokenCount"]),
        output: numberOr(parsed?.usageMetadata?.["candidatesTokenCount"]),
      },
      raw: body,
    };
  }

  async ping(): Promise<PingResult> {
    try {
      const { status } = await fetchJson(
        `${this.baseUrl.replace(/\/+$/, "")}/models`,
        { method: "GET", headers: { "x-goog-api-key": this.apiKey } },
        5_000,
      );
      return { reachable: status === 200, detail: status === 200 ? undefined : `HTTP ${status}` };
    } catch (cause) {
      return { reachable: false, detail: (cause as Error).message };
    }
  }

  async close(): Promise<void> {
    /* stateless */
  }
}

function numberOr(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
function strOr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

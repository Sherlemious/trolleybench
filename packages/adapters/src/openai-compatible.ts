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

/**
 * The workhorse adapter. One implementation covers Ollama, vLLM, LM Studio,
 * llama.cpp, LocalAI, text-generation-webui, Together, Groq and OpenRouter, because
 * they all speak POST /chat/completions. That is why "connect your own local model"
 * needs a flag rather than a plugin.
 */
export class OpenAICompatibleSubject implements Subject {
  readonly transport = "https" as const;

  constructor(
    readonly id: string,
    readonly spec: SubjectSpec,
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {
    if (!baseUrl) throw new ConfigError(`subject '${id}': base_url is required`);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    // Local servers generally accept any key, or none. Only send one if we have it.
    if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;
    return headers;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    messages.push({ role: "user", content: request.user });

    const payload: Record<string, unknown> = { model: this.spec.model, messages, stream: false };
    if (request.temperature !== undefined) payload["temperature"] = request.temperature;
    if (request.top_p !== undefined) payload["top_p"] = request.top_p;
    if (request.max_tokens !== undefined) payload["max_tokens"] = request.max_tokens;
    if (request.seed !== undefined) payload["seed"] = request.seed;

    const url = `${trimSlash(this.baseUrl)}/chat/completions`;
    const { status, body, text } = await fetchJson(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });

    if (status !== 200) {
      const detail = text.slice(0, 400);
      if (isRetryableStatus(status)) throw new TransientError(`HTTP ${status} from ${url}: ${detail}`, status);
      throw new Error(`HTTP ${status} from ${url}: ${detail}`);
    }

    const parsed = body as
      | { choices?: Array<{ message?: { content?: unknown } }>; model?: unknown; usage?: Record<string, unknown> }
      | undefined;
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(`unexpected response shape from ${url}: ${text.slice(0, 400)}`);
    }

    return {
      text: content,
      provider_model_string: typeof parsed?.model === "string" ? parsed.model : undefined,
      usage: {
        input: numberOr(parsed?.usage?.["prompt_tokens"]),
        output: numberOr(parsed?.usage?.["completion_tokens"]),
      },
      raw: body,
    };
  }

  async ping(): Promise<PingResult> {
    try {
      const { status, body } = await fetchJson(`${trimSlash(this.baseUrl)}/models`, { method: "GET", headers: this.headers() }, 5_000);
      if (status !== 200) return { reachable: false, detail: `HTTP ${status} from /models` };
      const data = (body as { data?: Array<{ id?: unknown }> } | undefined)?.data ?? [];
      const models = data.map((m) => String(m.id)).filter((m) => m !== "undefined");
      return { reachable: true, models };
    } catch (cause) {
      return { reachable: false, detail: (cause as Error).message };
    }
  }

  async close(): Promise<void> {
    /* stateless */
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function numberOr(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

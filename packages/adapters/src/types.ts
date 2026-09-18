import type { SubjectSpec, Transport } from "@trolleybench/spec";

export interface CompletionRequest {
  system?: string | undefined;
  user: string;
  temperature?: number | undefined;
  top_p?: number | undefined;
  max_tokens?: number | undefined;
  seed?: number | undefined;
}

export interface CompletionResponse {
  text: string;
  /**
   * What the provider actually reported, never the alias we asked for. A run pinned to
   * "claude-sonnet-5" that silently resolved to a different build is a different
   * experiment, and only the returned string can tell us that happened.
   */
  provider_model_string?: string | undefined;
  usage?: { input?: number; output?: number; reasoning?: number } | undefined;
  raw: unknown;
}

/** A thing that can be asked a question. Models, local servers, MCP subject providers. */
export interface Subject {
  readonly id: string;
  readonly spec: SubjectSpec;
  readonly transport: Transport;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  /** Liveness probe used by `trolley models`. Must not consume paid tokens where avoidable. */
  ping(): Promise<PingResult>;
  close(): Promise<void>;
}

export interface PingResult {
  reachable: boolean;
  detail?: string;
  models?: string[];
}

/** Retryable transport failure. Anything else is treated as a hard error. */
export class TransientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TransientError";
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** Shared fetch with timeout, so a hung local server cannot stall an entire run. */
export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 120_000,
): Promise<{ status: number; body: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown;
    try {
      body = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    return { status: response.status, body, text };
  } catch (cause) {
    const err = cause as Error;
    if (err.name === "AbortError") throw new TransientError(`request timed out after ${timeoutMs}ms`);
    throw new TransientError(`network failure: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

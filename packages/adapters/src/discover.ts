import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderKind, SubjectSpec } from "@trolley/spec";
import { fetchJson } from "./types.js";

export interface DiscoveredProvider {
  provider: ProviderKind;
  /** Where the credential came from, for display. Never the credential itself. */
  source: string;
  base_url?: string;
  api_key_env?: string;
  /** Concrete models we could confirm, when the provider can be listed for free. */
  models: string[];
  reachable: boolean;
  detail?: string;
}

const OLLAMA_DEFAULT = "http://localhost:11434";

/**
 * Minimal .env reader. No dotenv dependency: we only need KEY=VALUE, and a research
 * tool that wants a dependency to read its own config is one more install step
 * between a user and their first run.
 */
export async function readDotEnv(cwd: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of [".env.local", ".env"]) {
    let raw: string;
    try {
      raw = await readFile(join(cwd, name), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Real environment wins over a file, and .env.local wins over .env.
      if (!(key in out)) out[key] = value;
    }
  }
  return out;
}

export interface DiscoverOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Probe network endpoints. Off in tests that must not touch the network. */
  probe?: boolean;
}

/**
 * Zero-config subject discovery: look at the environment and report what is actually
 * reachable. If Ollama is running, the user's local models simply appear - there is
 * nothing to configure, which is the entire point of the local-first decision.
 */
export async function discoverProviders(options: DiscoverOptions = {}): Promise<DiscoveredProvider[]> {
  const cwd = options.cwd ?? process.cwd();
  const fileEnv = await readDotEnv(cwd);
  const env = { ...fileEnv, ...(options.env ?? process.env) };
  const probe = options.probe ?? true;
  const found: DiscoveredProvider[] = [];

  const keyed: Array<[ProviderKind, string[], string | undefined]> = [
    ["anthropic", ["ANTHROPIC_API_KEY"], undefined],
    ["openai", ["OPENAI_API_KEY"], env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1"],
    ["google", ["GEMINI_API_KEY", "GOOGLE_API_KEY"], undefined],
    ["openai_compatible", ["OPENROUTER_API_KEY"], "https://openrouter.ai/api/v1"],
  ];

  for (const [provider, candidates, baseUrl] of keyed) {
    const varName = candidates.find((name) => (env[name] ?? "").length > 0);
    if (!varName) continue;
    found.push({
      provider,
      source: varName,
      api_key_env: varName,
      base_url: baseUrl,
      models: [],
      reachable: true,
    });
  }

  // Ollama: no key, so presence is decided purely by whether it answers.
  const ollamaHost = (env["OLLAMA_HOST"] ?? OLLAMA_DEFAULT).replace(/\/+$/, "");
  const normalizedHost = /^https?:\/\//.test(ollamaHost) ? ollamaHost : `http://${ollamaHost}`;
  if (probe) {
    const tags = await listOllamaModels(normalizedHost);
    if (tags.reachable) {
      found.push({
        provider: "openai_compatible",
        source: env["OLLAMA_HOST"] ? "OLLAMA_HOST" : "ollama (default port)",
        base_url: `${normalizedHost}/v1`,
        models: tags.models,
        reachable: true,
      });
    } else if (env["OLLAMA_HOST"]) {
      // Explicitly configured but not answering: worth saying so rather than hiding it.
      found.push({
        provider: "openai_compatible",
        source: "OLLAMA_HOST",
        base_url: `${normalizedHost}/v1`,
        models: [],
        reachable: false,
        detail: tags.detail,
      });
    }
  }

  // A bare OPENAI_BASE_URL with no key is the self-hosted vLLM / LM Studio case.
  const customBase = env["OPENAI_BASE_URL"];
  if (customBase && !(env["OPENAI_API_KEY"] ?? "").length) {
    found.push({
      provider: "openai_compatible",
      source: "OPENAI_BASE_URL",
      base_url: customBase,
      models: [],
      reachable: true,
    });
  }

  return found;
}

async function listOllamaModels(host: string): Promise<{ reachable: boolean; models: string[]; detail?: string }> {
  try {
    const { status, body } = await fetchJson(`${host}/api/tags`, { method: "GET" }, 3_000);
    if (status !== 200) return { reachable: false, models: [], detail: `HTTP ${status}` };
    const models = ((body as { models?: Array<{ name?: unknown }> } | undefined)?.models ?? [])
      .map((m) => String(m.name))
      .filter((m) => m !== "undefined")
      .sort();
    return { reachable: true, models };
  } catch (cause) {
    return { reachable: false, models: [], detail: (cause as Error).message };
  }
}

/** Turn a discovered provider plus a model name into a runnable subject spec. */
export function specFor(discovered: DiscoveredProvider, model: string, id?: string): SubjectSpec {
  return {
    id: id ?? sanitizeId(`${discovered.provider}-${model}`),
    kind: "model",
    provider: discovered.provider,
    model,
    base_url: discovered.base_url,
    api_key_env: discovered.api_key_env,
    params: {},
  } as SubjectSpec;
}

export function sanitizeId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

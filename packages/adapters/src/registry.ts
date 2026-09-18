import type { SubjectSpec } from "@trolleybench/spec";
import { AnthropicSubject } from "./anthropic.js";
import { EchoSubject, type EchoBehaviour } from "./echo.js";
import { GoogleSubject } from "./google.js";
import { OpenAICompatibleSubject } from "./openai-compatible.js";
import { ConfigError, type Subject } from "./types.js";

export interface CreateOptions {
  env?: NodeJS.ProcessEnv;
  /** Extra values merged under the real environment, e.g. parsed from .env. */
  fileEnv?: Record<string, string>;
  echoBehaviour?: EchoBehaviour;
  seed?: number;
}

const DEFAULT_KEY_ENV: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  openai_compatible: ["OPENAI_API_KEY", "OPENROUTER_API_KEY"],
};

export function createSubject(spec: SubjectSpec, options: CreateOptions = {}): Subject {
  const env = { ...(options.fileEnv ?? {}), ...(options.env ?? process.env) };
  const key = resolveKey(spec, env);

  switch (spec.provider) {
    case "anthropic":
      return new AnthropicSubject(spec.id, spec, requireKey(spec, key, "ANTHROPIC_API_KEY"), spec.base_url);

    case "google":
      return new GoogleSubject(spec.id, spec, requireKey(spec, key, "GEMINI_API_KEY"), spec.base_url);

    case "openai":
      return new OpenAICompatibleSubject(
        spec.id,
        spec,
        spec.base_url ?? env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1",
        requireKey(spec, key, "OPENAI_API_KEY"),
      );

    case "openai_compatible": {
      const baseUrl = spec.base_url ?? env["OPENAI_BASE_URL"];
      if (!baseUrl) {
        throw new ConfigError(
          `subject '${spec.id}': openai_compatible needs a base_url. ` +
            `Pass --base-url, set OPENAI_BASE_URL, or start Ollama so it is discovered automatically.`,
        );
      }
      // Local servers usually need no credential at all, so a missing key is fine here.
      return new OpenAICompatibleSubject(spec.id, spec, baseUrl, key);
    }

    case "echo":
      return new EchoSubject(spec.id, spec, options.echoBehaviour ?? "mixed", options.seed ?? 0);

    case "mcp_subject":
      throw new ConfigError(
        `subject '${spec.id}': the MCP Subject Provider Protocol arrives in Phase 3. ` +
          `Until then, expose your model over an OpenAI-compatible endpoint and use --base-url.`,
      );

    default: {
      const exhaustive: never = spec.provider;
      throw new ConfigError(`unknown provider: ${String(exhaustive)}`);
    }
  }
}

function resolveKey(spec: SubjectSpec, env: Record<string, string | undefined>): string | undefined {
  const names = spec.api_key_env ? [spec.api_key_env] : (DEFAULT_KEY_ENV[spec.provider] ?? []);
  for (const name of names) {
    const value = env[name];
    if (value && value.length > 0) return value;
  }
  return undefined;
}

function requireKey(spec: SubjectSpec, key: string | undefined, suggested: string): string {
  if (key) return key;
  throw new ConfigError(
    `subject '${spec.id}': no API key found. Set ${spec.api_key_env ?? suggested} in your environment or .env file.`,
  );
}

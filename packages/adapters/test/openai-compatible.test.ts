import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SubjectSpec } from "@trolleybench/spec";
import { OpenAICompatibleSubject } from "../src/openai-compatible.js";
import { TransientError } from "../src/types.js";

interface Captured {
  path: string;
  auth: string | undefined;
  body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let captured: Captured[] = [];
/** Per-path scripted responses, so each test drives the stub independently. */
let script: Map<string, Planned>;
interface Planned {
  status: number;
  body: unknown;
  raw?: string;
  /** Answer from the request body instead, for tests whose attempts must differ. */
  respond?: (body: Record<string, unknown>) => { status: number; body: unknown };
}
let attemptsByPath: Map<string, number>;

/**
 * A real HTTP server speaking the OpenAI /chat/completions contract. This is the exact
 * protocol Ollama, vLLM and LM Studio expose, so exercising it over a socket - rather
 * than stubbing fetch - is what actually verifies the local-model path.
 */
beforeAll(async () => {
  script = new Map();
  attemptsByPath = new Map();

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = req.url ?? "/";
      attemptsByPath.set(path, (attemptsByPath.get(path) ?? 0) + 1);
      const text = Buffer.concat(chunks).toString("utf8");
      let body: Record<string, unknown> = {};
      try {
        body = text.length > 0 ? JSON.parse(text) : {};
      } catch {
        /* recorded as empty */
      }
      captured.push({ path, auth: req.headers["authorization"] as string | undefined, body });

      const scripted = script.get(path);
      const planned: Planned = scripted?.respond ? scripted.respond(body) : scripted ?? {
        status: 200,
        body: {
          model: "stub-model-v1.2",
          choices: [{ message: { role: "assistant", content: "A" } }],
          usage: { prompt_tokens: 11, completion_tokens: 3 },
        },
      };
      res.writeHead(planned.status, { "content-type": "application/json" });
      res.end(planned.raw ?? JSON.stringify(planned.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function subject(over: Partial<SubjectSpec> = {}, apiKey?: string) {
  const spec = { id: "s", kind: "model", provider: "openai_compatible", model: "llama3", params: {} , ...over } as SubjectSpec;
  return new OpenAICompatibleSubject("s", spec, baseUrl, apiKey);
}

describe("OpenAI-compatible adapter", () => {
  it("sends a well-formed chat completion and reads the reply", async () => {
    captured = [];
    const response = await subject().complete({ system: "Be brief.", user: "Choose A or B." });

    expect(response.text).toBe("A");
    expect(response.provider_model_string).toBe("stub-model-v1.2");
    expect(response.usage).toEqual({ input: 11, output: 3 });

    const sent = captured.at(-1)!;
    expect(sent.path).toBe("/v1/chat/completions");
    expect(sent.body["model"]).toBe("llama3");
    expect(sent.body["stream"]).toBe(false);
    expect(sent.body["messages"]).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "Choose A or B." },
    ]);
  });

  it("omits the system message entirely when there is none", async () => {
    captured = [];
    await subject().complete({ user: "hi" });
    expect(captured.at(-1)!.body["messages"]).toEqual([{ role: "user", content: "hi" }]);
  });

  // Local servers generally accept any key or none; sending a bogus header can break them.
  it("sends no Authorization header when no key is configured", async () => {
    captured = [];
    await subject().complete({ user: "hi" });
    expect(captured.at(-1)!.auth).toBeUndefined();
  });

  it("sends a bearer token when a key is configured", async () => {
    captured = [];
    await subject({}, "sk-test-123").complete({ user: "hi" });
    expect(captured.at(-1)!.auth).toBe("Bearer sk-test-123");
  });

  it("forwards sampling parameters only when supplied", async () => {
    captured = [];
    await subject().complete({ user: "hi", temperature: 0, max_tokens: 64 });
    const body = captured.at(-1)!.body;
    expect(body["temperature"]).toBe(0);
    expect(body["max_tokens"]).toBe(64);
    expect("top_p" in body).toBe(false);
    expect("seed" in body).toBe(false);
  });

  /**
   * The distinction the retry loop depends on: 429 and 5xx are worth retrying, a 400
   * is a bug in our request and retrying it just wastes the user's quota.
   */
  it("raises TransientError on 429 so the runner retries", async () => {
    script.set("/v1/chat/completions", { status: 429, body: { error: "slow down" } });
    await expect(subject().complete({ user: "hi" })).rejects.toBeInstanceOf(TransientError);
    script.delete("/v1/chat/completions");
  });

  it("raises TransientError on 503", async () => {
    script.set("/v1/chat/completions", { status: 503, body: { error: "unavailable" } });
    await expect(subject().complete({ user: "hi" })).rejects.toBeInstanceOf(TransientError);
    script.delete("/v1/chat/completions");
  });

  it("raises a permanent error on 400", async () => {
    script.set("/v1/chat/completions", { status: 400, body: { error: "bad model" } });
    const err = await subject().complete({ user: "hi" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TransientError);
    expect((err as Error).message).toContain("400");
    script.delete("/v1/chat/completions");
  });

  it("rejects a malformed 200 rather than inventing an answer", async () => {
    script.set("/v1/chat/completions", { status: 200, body: { choices: [] } });
    await expect(subject().complete({ user: "hi" })).rejects.toThrow(/unexpected response shape/);
    script.delete("/v1/chat/completions");
  });

  it("rejects non-JSON served with a 200", async () => {
    script.set("/v1/chat/completions", { status: 200, body: undefined, raw: "<html>proxy error</html>" });
    await expect(subject().complete({ user: "hi" })).rejects.toThrow(/unexpected response shape/);
    script.delete("/v1/chat/completions");
  });

  it("reports reachability and model list from /models", async () => {
    script.set("/v1/models", { status: 200, body: { data: [{ id: "llama3" }, { id: "mistral" }] } });
    const result = await subject().ping();
    expect(result.reachable).toBe(true);
    expect(result.models).toEqual(["llama3", "mistral"]);
    script.delete("/v1/models");
  });

  it("reports unreachable rather than throwing when the endpoint is dead", async () => {
    const dead = new OpenAICompatibleSubject(
      "s",
      { id: "s", kind: "model", provider: "openai_compatible", model: "m", params: {} } as SubjectSpec,
      "http://127.0.0.1:1/v1",
    );
    const result = await dead.ping();
    expect(result.reachable).toBe(false);
    expect(result.detail).toBeTruthy();
  });

  describe("logprobs", () => {
    const path = "/v1/chat/completions";
    const labels = { labels: ["A", "B"] };
    const reply = (content: string, logprobs: unknown) => ({
      status: 200,
      body: { model: "stub", choices: [{ message: { role: "assistant", content }, logprobs }] },
    });

    it("asks for logprobs only when requested", async () => {
      captured = [];
      await subject().complete({ user: "hi" });
      expect("logprobs" in captured.at(-1)!.body).toBe(false);
      await subject().complete({ user: "hi", logprobs: labels });
      expect(captured.at(-1)!.body["logprobs"]).toBe(true);
      expect(captured.at(-1)!.body["top_logprobs"]).toBe(20);
    });

    it("reads a renormalised distribution at the answer token, across variants", async () => {
      script.set(path, reply(" B", {
        content: [{
          token: " B", logprob: Math.log(0.5),
          top_logprobs: [
            { token: " B", logprob: Math.log(0.5) },
            { token: "B", logprob: Math.log(0.1) },
            { token: " A", logprob: Math.log(0.2) },
            { token: "a", logprob: Math.log(0.1) },
            { token: "I", logprob: Math.log(0.1) },
          ],
        }],
      }));
      const r = await subject().complete({ user: "hi", logprobs: labels });
      expect(r.label_probs!["B"]).toBeCloseTo(0.6 / 0.9, 12);
      expect(r.label_probs!["A"]).toBeCloseTo(0.3 / 0.9, 12);
      script.delete(path);
    });

    it("records nothing when the server ignores the parameter", async () => {
      script.set(path, reply("A", undefined));
      const r = await subject().complete({ user: "hi", logprobs: labels });
      expect(r.text).toBe("A");
      expect(r.label_probs).toBeUndefined();
      script.set(path, reply("A", null));
      expect((await subject().complete({ user: "hi", logprobs: labels })).label_probs).toBeUndefined();
      script.delete(path);
    });

    it("records nothing when the answer is not the first token", async () => {
      script.set(path, reply("The answer is A", {
        content: [
          { token: "The", logprob: -0.1, top_logprobs: [{ token: "The", logprob: -0.1 }, { token: "A", logprob: -3 }] },
          { token: " answer", logprob: -0.1, top_logprobs: [] },
        ],
      }));
      const r = await subject().complete({ user: "hi", logprobs: labels });
      expect(r.label_probs).toBeUndefined();
      script.delete(path);
    });

    it("retries without logprobs when the server rejects them, and keeps the answer", async () => {
      captured = [];
      script.set(path, {
        status: 0,
        body: null,
        respond: (body) =>
          "logprobs" in body
            ? { status: 400, body: { error: { message: "`logprobs` is not supported with this model" } } }
            : { status: 200, body: { model: "stub", choices: [{ message: { role: "assistant", content: "B" } }] } },
      });
      const r = await subject().complete({ user: "hi", logprobs: labels });
      expect(r.text).toBe("B");
      expect(r.label_probs).toBeUndefined();
      expect(captured).toHaveLength(2);
      expect("top_logprobs" in captured[1]!.body).toBe(false);
      script.delete(path);
    });

    it("does not retry a 400 that has nothing to do with logprobs", async () => {
      captured = [];
      script.set(path, { status: 400, body: { error: "bad model" } });
      await expect(subject().complete({ user: "hi", logprobs: labels })).rejects.toThrow(/400/);
      expect(captured).toHaveLength(1);
      script.delete(path);
    });
  });

  it("tolerates a base url with a trailing slash", async () => {
    captured = [];
    const spec = { id: "s", kind: "model", provider: "openai_compatible", model: "m", params: {} } as SubjectSpec;
    await new OpenAICompatibleSubject("s", spec, `${baseUrl}/`).complete({ user: "hi" });
    expect(captured.at(-1)!.path).toBe("/v1/chat/completions");
  });
});

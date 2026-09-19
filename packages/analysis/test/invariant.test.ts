import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * SCHEMA INVARIANT 1, checked the way PLAN.md says to check it.
 *
 * The plan is explicit that a `@ts-expect-error` test is the weaker check and the API
 * shape audit is the real one: a type error proves one written call shape is rejected,
 * while this catches the actual failure mode — a helper added later that quietly takes
 * `ResultRow[]` and aggregates across modes. `ModeScoped` has no constructor, so as
 * long as no exported entry point accepts bare rows, pooling is unreachable.
 *
 * Source text rather than types, deliberately. The thing being defended is the shape of
 * the public API, and that is a property of what is written down.
 */
const SRC = join(process.cwd(), "packages", "analysis", "src");

function sources(): { file: string; text: string }[] {
  return readdirSync(SRC)
    .filter((f) => f.endsWith(".ts"))
    .map((file) => ({ file, text: readFileSync(join(SRC, file), "utf8") }));
}

describe("aggregates cannot be reached without partitioning by mode", () => {
  it("has sources to audit", () => {
    expect(sources().length).toBeGreaterThan(5);
  });

  it("exports no function taking a bare ResultRow array", () => {
    const offenders: string[] = [];

    for (const { file, text } of sources()) {
      // Every parameter position mentioning an array of ResultRow.
      const pattern = /(\breadonly\s+)?ResultRow\s*\[\]/g;
      for (const match of text.matchAll(pattern)) {
        const start = match.index ?? 0;
        const line = text.slice(0, start).split("\n").length;
        const context = text.slice(Math.max(0, start - 200), start);

        // Legitimate: wrapped in the brand, or a local (non-exported) declaration.
        if (/ModeScoped<[^>]*,\s*$/.test(context.trimEnd().slice(-40))) continue;
        if (context.includes("ModeScoped<") && !context.slice(context.lastIndexOf("ModeScoped<")).includes(")")) {
          continue;
        }
        // Return types and local variables are fine; only exported PARAMETERS pool.
        const declaration = context.slice(context.lastIndexOf("export "));
        if (!declaration.startsWith("export function")) continue;

        offenders.push(`${file}:${line}`);
      }
    }

    expect(offenders, `exported aggregate accepts unpartitioned rows at ${offenders.join(", ")}`).toEqual(
      [],
    );
  });

  it("names partitionByMode as the only producer, and does not re-export a widener", () => {
    for (const { file, text } of sources()) {
      // A local cast back to the brand would be a constructor by another name.
      expect(text, `${file} casts to ModeScoped`).not.toMatch(/as\s+ModeScoped</);
      expect(text, `${file} re-exports scopeToMode`).not.toMatch(/export\s+\{[^}]*scopeToMode/);
    }
  });
});

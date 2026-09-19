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

interface ExportedFunction {
  name: string;
  line: number;
  /** Signature only: from `export function` to the opening brace of the body. */
  signature: string;
  /** The JSDoc block immediately above, if any. */
  doc: string;
}

function exportedFunctions(text: string): ExportedFunction[] {
  const out: ExportedFunction[] = [];
  const pattern = /export function (\w+)/g;

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const bodyStart = text.indexOf("{", start + match[0].length);
    if (bodyStart < 0) continue;

    const before = text.slice(0, start);
    const docEnd = before.lastIndexOf("*/");
    const docStart = docEnd >= 0 ? before.lastIndexOf("/**", docEnd) : -1;
    // Only count the block as this function's doc when nothing but whitespace
    // separates them, so a marker on an unrelated declaration cannot vouch for it.
    const between = docEnd >= 0 ? before.slice(docEnd + 2) : "x";

    out.push({
      name: match[1]!,
      line: before.split("\n").length,
      signature: text.slice(start, bodyStart),
      doc: docStart >= 0 && between.trim() === "" ? before.slice(docStart, docEnd) : "",
    });
  }
  return out;
}

describe("aggregates cannot be reached without partitioning by mode", () => {
  it("has sources to audit", () => {
    expect(sources().length).toBeGreaterThan(5);
  });

  it("exports no function taking a bare ResultRow array", () => {
    const offenders: string[] = [];

    for (const { file, text } of sources()) {
      for (const fn of exportedFunctions(text)) {
        // Parameter list only. A return type of ResultRow[] is not a pooling risk.
        const params = fn.signature.slice(fn.signature.indexOf("("));
        const closing = params.lastIndexOf("):");
        const parameterList = closing >= 0 ? params.slice(0, closing) : params;

        if (!/(\breadonly\s+)?ResultRow\s*\[\]/.test(parameterList)) continue;
        if (/ModeScoped</.test(parameterList)) continue;

        // Explicitly marked pre-partition helpers are allowed, and only those.
        //
        // Some work genuinely has to happen before partitioning: `authoritativeRows`
        // resolves duplicate attempts at a cell, and doing it per-mode afterwards would
        // be the same pass repeated. What makes that safe is that it is a filter — rows
        // in, rows out, no statistic — and that it keys on elicitation_mode, so it
        // cannot pool by deletion either.
        //
        // The marker is a written claim, not an inferred property. A return-type
        // heuristic would exempt functions nobody thought about; requiring the author to
        // type @pre-partition in the function's own doc comment means every exemption is
        // a decision that shows up in a diff and can be argued with in review.
        if (/@pre-partition\b/.test(fn.doc)) continue;

        offenders.push(`${file}:${fn.line} ${fn.name}`);
      }
    }

    expect(
      offenders,
      `exported aggregate accepts unpartitioned rows: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("allows the exemption only where it is actually written down", () => {
    // Guards the guard: if the marker check ever stopped reading the function's own
    // doc, every exemption would pass silently. Exactly the helpers below may carry it.
    const marked: string[] = [];
    for (const { file, text } of sources()) {
      for (const fn of exportedFunctions(text)) {
        if (/@pre-partition\b/.test(fn.doc)) marked.push(`${file}:${fn.name}`);
      }
    }
    expect(marked.sort()).toEqual([
      "authoritative.ts:authoritativeRows",
      "authoritative.ts:duplicateReport",
    ]);
  });

  it("does not re-export a widener or cast back to the brand", () => {
    for (const { file, text } of sources()) {
      expect(text, `${file} casts to ModeScoped`).not.toMatch(/as\s+ModeScoped</);
      expect(text, `${file} re-exports scopeToMode`).not.toMatch(/export\s+\{[^}]*scopeToMode/);
    }
  });
});

import { parse as parseIcu } from "@messageformat/parser";

/**
 * Extract the argument names an ICU template actually references.
 *
 * This walks the real AST rather than pattern-matching braces. A regex cannot tell an
 * argument reference from a plural branch body: in
 *   {n, plural, one{person} other{group}}
 * `{person}` and `{group}` are branch text, not arguments. Getting that wrong produced
 * confident, wholly bogus validation errors.
 */
export function referencedArguments(template: string): string[] {
  const found = new Set<string>();
  collect(parseIcu(template) as unknown[], found);
  return [...found].sort();
}

function collect(tokens: readonly unknown[], out: Set<string>): void {
  for (const token of tokens) {
    if (typeof token !== "object" || token === null) continue;
    const node = token as { arg?: unknown; cases?: unknown; param?: unknown };

    if (typeof node.arg === "string") out.add(node.arg);

    // plural / select / selectordinal
    if (Array.isArray(node.cases)) {
      for (const branch of node.cases) {
        const tokens = (branch as { tokens?: unknown }).tokens;
        if (Array.isArray(tokens)) collect(tokens, out);
      }
    }
    // custom function arguments may themselves contain nested tokens
    if (Array.isArray(node.param)) collect(node.param, out);
  }
}

/**
 * The arguments that some plural (or selectordinal) in the template gives an exact
 * `=<n>` branch, e.g. `exactBranchArguments(src, 0)` for `{n, plural, =0{nobody} ...}`.
 * Nested messages are searched too, so a `=0` inside another branch still counts.
 */
export function exactBranchArguments(template: string, n: number): string[] {
  const found = new Set<string>();
  collectExact(parseIcu(template) as unknown[], `=${n}`, found);
  return [...found].sort();
}

function collectExact(tokens: readonly unknown[], key: string, out: Set<string>): void {
  for (const token of tokens) {
    if (typeof token !== "object" || token === null) continue;
    const node = token as { type?: unknown; arg?: unknown; cases?: unknown };
    if (!Array.isArray(node.cases)) continue;
    const plural = node.type === "plural" || node.type === "selectordinal";
    for (const branch of node.cases) {
      const b = branch as { key?: unknown; tokens?: unknown };
      if (plural && b.key === key && typeof node.arg === "string") out.add(node.arg);
      if (Array.isArray(b.tokens)) collectExact(b.tokens, key, out);
    }
  }
}

/** Syntax check, reported as a message rather than thrown. */
export function icuSyntaxError(template: string): string | undefined {
  try {
    parseIcu(template);
    return undefined;
  } catch (cause) {
    return (cause as Error).message.split("\n")[0];
  }
}

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

/**
 * Hand-rolled argument parsing. A research tool competes with "pip install and run",
 * so every dependency is a step between a user and their first result; this is the
 * amount of parsing we actually need.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  let command: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;

    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags.set(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags.set(body, next);
        i++;
      } else {
        flags.set(body, true);
      }
      continue;
    }

    if (command === undefined) command = token;
    else positionals.push(token);
  }

  return { command, positionals, flags };
}

export function str(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

export function bool(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true || args.flags.get(name) === "true";
}

export function num(args: ParsedArgs, name: string, fallback: number): number {
  const raw = str(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new UsageError(`--${name} expects a number, got '${raw}'`);
  return value;
}

export function list(args: ParsedArgs, name: string): string[] | undefined {
  const raw = str(args, name);
  if (raw === undefined) return undefined;
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

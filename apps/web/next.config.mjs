import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: the latter yields "/I:/..." on Windows.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Next reads `.env.local` relative to the app directory, but this is a monorepo and the
 * single `.env.local` lives at the repo root, where the CLI already looks for it. Load
 * it here so `pnpm dev` and `trolley db …` read the same connection string rather than
 * needing two copies of a secret on disk.
 *
 * Non-fatal by design: on Vercel and in CI there is no such file, and `DATABASE_URL`
 * arrives from the platform's environment instead. The real environment always wins —
 * same precedence rule the CLI's reader uses, so the two cannot disagree.
 */
function loadRepoRootEnv() {
  let raw;
  try {
    raw = readFileSync(join(repoRoot, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadRepoRootEnv();

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Scenario packs are read from content/ at build time, which sits outside this app.
  outputFileTracingRoot: repoRoot,
};

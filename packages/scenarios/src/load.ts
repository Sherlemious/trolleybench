import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ScenarioPack, SuiteDef } from "@trolleybench/spec";
import { contentHash, normalizeString } from "@trolleybench/engine";

export interface LoadedPack {
  pack: ScenarioPack;
  /** Hash of the pack source as authored - changes whenever any template changes. */
  digest: string;
  path: string;
}

export async function loadPackFile(path: string): Promise<LoadedPack> {
  const raw = normalizeString(await readFile(path, "utf8"));
  const parsed = parseYaml(raw);
  const result = ScenarioPack.safeParse(parsed);
  if (!result.success) {
    throw new Error(`invalid pack at ${path}:\n${formatZodIssues(result.error.issues)}`);
  }
  return { pack: result.data, digest: contentHash(result.data), path };
}

/** Load every `pack.yaml` under a directory of pack folders. */
export async function loadPackDir(dir: string): Promise<LoadedPack[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const packs: LoadedPack[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    packs.push(await loadPackFile(join(dir, entry.name, "pack.yaml")));
  }
  return packs;
}

export async function loadSuiteFile(path: string): Promise<SuiteDef> {
  const raw = normalizeString(await readFile(path, "utf8"));
  const result = SuiteDef.safeParse(parseYaml(raw));
  if (!result.success) {
    throw new Error(`invalid suite at ${path}:\n${formatZodIssues(result.error.issues)}`);
  }
  return result.data;
}

export function formatZodIssues(issues: readonly { path: (string | number)[]; message: string }[]): string {
  return issues.map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`).join("\n");
}

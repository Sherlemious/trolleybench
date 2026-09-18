/**
 * Rewrite every hashable content file to CRLF line endings, in place.
 *
 * This exists for one CI job. Content hashing normalizes CRLF to LF before digesting,
 * and that normalization is the single thing standing between a Windows contributor and
 * a suite lockfile that disagrees with everyone else's. The obvious way to test it —
 * `git config core.autocrlf true` before checkout — does not work here, because
 * .gitattributes pins `eol=lf` and .gitattributes wins. So we corrupt the bytes
 * ourselves and demand the digest come out the same.
 *
 * Node rather than perl or unix2dos: `actions/setup-node` has already run, so this is
 * the one interpreter the job is guaranteed to have on every runner.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EXTENSIONS = new Set([".yaml", ".yml", ".json", ".jsonl", ".md"]);
const root = process.argv[2] ?? "content";

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

let converted = 0;
for (const path of walk(root)) {
  if (!EXTENSIONS.has(path.slice(path.lastIndexOf(".")))) continue;
  const text = readFileSync(path, "utf8");
  // Normalize to LF first so a file that is already CRLF does not become CRCRLF.
  const crlf = text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  if (crlf !== text) converted += 1;
  writeFileSync(path, crlf, "utf8");
}

// Confirm here rather than in a shell step. `grep -q $'\r'` is the obvious check and it
// reports no match on Git Bash under windows-latest even when the bytes are plainly
// CR LF - so the shell version of this guard silently passes on a tree it never checked.
const sample = join(root, "packs", "classic", "pack.yaml");
const bytes = readFileSync(sample);
if (!bytes.includes(0x0d)) {
  console.error(`::error::${sample} has no CR bytes; this job would assert nothing`);
  process.exit(1);
}

console.log(`rewrote ${converted} file(s) under ${root}/ to CRLF; ${sample} verified CRLF`);
if (converted === 0) {
  console.error("::error::nothing was converted; this job would assert nothing");
  process.exit(1);
}

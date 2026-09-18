import { createHash } from "node:crypto";

/**
 * Canonical serialization. This is the whole basis of reproducibility: the same
 * scenario must hash identically on Windows, macOS and Linux, in CI and on a
 * contributor's laptop.
 *
 * Three things are normalized, and each one is a real way this has broken before:
 *   - key order      -> object iteration order must not leak into the hash
 *   - line endings   -> CRLF from a Windows checkout would fork every hash
 *   - Unicode form   -> NFC, so composed vs decomposed accents agree
 *
 * `undefined` members are dropped so an absent optional and an explicitly-undefined
 * one cannot disagree.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string") return normalizeString(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`non-finite number cannot be canonicalized: ${value}`);
    // -0 and 0 must not produce different hashes.
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "undefined") return undefined;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      const v = canonicalize(src[key]);
      if (v !== undefined) out[normalizeString(key)] = v;
    }
    return out;
  }
  throw new Error(`unsupported type in canonical form: ${typeof value}`);
}

/** LF line endings, NFC normalization. Applied to every string that enters a hash. */
export function normalizeString(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").normalize("NFC");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** `sha256:<64 hex>` over the canonical JSON form. */
export function contentHash(value: unknown): string {
  const hash = createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
  return `sha256:${hash}`;
}

/** Digest over an unordered collection of hashes - order-independent by construction. */
export function digestOf(hashes: readonly string[]): string {
  return contentHash([...hashes].sort());
}

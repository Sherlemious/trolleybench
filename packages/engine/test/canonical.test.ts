import { describe, expect, it } from "vitest";
import { canonicalJson, contentHash, digestOf, normalizeString } from "../src/canonical.js";

describe("canonical form", () => {
  it("is insensitive to object key order", () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash({ x: { p: 1, q: 2 } })).toBe(contentHash({ x: { q: 2, p: 1 } }));
  });

  it("is sensitive to array order, which is semantic", () => {
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
  });

  // The Windows failure mode: a CRLF checkout must not fork every hash.
  it("normalizes CRLF and CR to LF", () => {
    const lf = contentHash({ text: "one\ntwo\nthree" });
    expect(contentHash({ text: "one\r\ntwo\r\nthree" })).toBe(lf);
    expect(contentHash({ text: "one\rtwo\rthree" })).toBe(lf);
  });

  // The macOS failure mode: decomposed accents from a filesystem round-trip.
  it("normalizes Unicode to NFC", () => {
    const composed = "café";            // U+00E9
    const decomposed = "cafe\u0301";    // e + combining acute
    expect(composed).not.toBe(decomposed);
    expect(contentHash({ t: composed })).toBe(contentHash({ t: decomposed }));
  });

  it("normalizes keys as well as values", () => {
    expect(contentHash({ "cafe\u0301": 1 })).toBe(contentHash({ "café": 1 }));
  });

  it("treats absent and explicitly-undefined members alike", () => {
    expect(contentHash({ a: 1 })).toBe(contentHash({ a: 1, b: undefined }));
  });

  it("collapses -0 to 0", () => {
    expect(contentHash({ n: -0 })).toBe(contentHash({ n: 0 }));
  });

  it("rejects non-finite numbers rather than hashing them as null", () => {
    expect(() => contentHash({ n: NaN })).toThrow(/non-finite/);
    expect(() => contentHash({ n: Infinity })).toThrow(/non-finite/);
  });

  it("emits the documented hash shape", () => {
    expect(contentHash({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("produces a stable known digest (regression guard)", () => {
    // If this changes, every frozen suite in existence is invalidated. That should
    // only ever happen deliberately, with a spec version bump.
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe('{"a":[2,{"c":3,"d":4}],"b":1}');
  });

  it("digestOf is order-independent over its input", () => {
    const a = contentHash("one");
    const b = contentHash("two");
    expect(digestOf([a, b])).toBe(digestOf([b, a]));
  });

  it("normalizeString is idempotent", () => {
    const once = normalizeString("a\r\nb\u0301");
    expect(normalizeString(once)).toBe(once);
  });
});

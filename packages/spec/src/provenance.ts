import { z } from "zod";
import { Id, LicenseId } from "./primitives.js";

/**
 * How a cited work relates to a scenario.
 * `origin`      - the paper that introduced this dilemma
 * `adaptation`  - a paper whose variant we reproduce
 * `design`      - a paper supplying the experimental design (e.g. CNI, conjoint)
 * `critique`    - a paper arguing against this design; recorded so it surfaces in reports
 */
export const CitationRole = z.enum(["origin", "adaptation", "design", "critique"]);

export const Citation = z.object({
  citekey: Id,
  role: CitationRole,
  /**
   * Citations are UNVERIFIED until a human confirms them against the source.
   * Nothing with `verified: false` may be presented as provenance in a published
   * report - a wrong citation here propagates into every downstream result row.
   */
  verified: z.boolean().default(false),
  note: z.string().max(500).optional(),
});

export const Provenance = z.object({
  papers: z.array(Citation).default([]),
  license: LicenseId,
  authors: z.array(z.string()).default([]),
  /** Upstream dataset this was derived from, if any. Drives license notice generation. */
  derived_from: z
    .object({ dataset: z.string(), url: z.string().url().optional(), license: LicenseId })
    .optional(),
});

export type CitationRole = z.infer<typeof CitationRole>;
export type Citation = z.infer<typeof Citation>;
export type Provenance = z.infer<typeof Provenance>;

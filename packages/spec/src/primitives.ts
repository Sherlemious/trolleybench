import { z } from "zod";

/** Stable identifier: lowercase, dot-separated namespaces. e.g. `thomson.footbridge` */
export const Id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+([._-][a-z0-9]+)*$/, "ids are lowercase alphanumeric with . _ - separators");

/** Semantic version of a pack or template. */
export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/, "expected MAJOR.MINOR.PATCH");

/** A sha256 content hash, lowercase hex, `sha256:` prefixed. */
export const ContentHash = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/** BCP-47 language tag. Deliberately permissive; validated against the i18n registry at load. */
export const LanguageTag = z.string().regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/);

export const Iso8601 = z.string().datetime({ offset: true });

/** SPDX-ish license identifier for content provenance. */
export const LicenseId = z.string().min(1).max(64);

export type Id = z.infer<typeof Id>;
export type SemVer = z.infer<typeof SemVer>;
export type ContentHash = z.infer<typeof ContentHash>;
export type LanguageTag = z.infer<typeof LanguageTag>;

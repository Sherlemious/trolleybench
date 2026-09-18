import type { ScenarioInstance, SuiteDef, SuiteLock } from "@trolley/spec";
import { digestOf } from "@trolley/engine";
import type { LoadedPack } from "./load.js";
import { expandSuite } from "./expand-suite.js";

/**
 * Freeze a suite: pin the exact set of instance hashes it contains.
 *
 * Re-freezing on another machine must produce an identical lock. That cross-platform
 * check is a Phase 0 gate rather than a Phase 5 nicety, because retrofitting hashing
 * onto a populated scenario library is a week-long migration.
 */
export function freezeSuite(
  packs: readonly LoadedPack[],
  suite: SuiteDef,
  now: () => string = () => new Date().toISOString(),
): SuiteLock {
  const instances = expandSuite(packs, suite);
  const hashes = instances.map((i) => i.hash).sort();

  const duplicates = hashes.filter((h, i) => i > 0 && h === hashes[i - 1]);
  if (duplicates.length > 0) {
    throw new Error(
      `suite '${suite.id}' expands to ${duplicates.length} duplicate instance(s). ` +
        `Two design cells rendered identically - usually a factor that no template text references.`,
    );
  }

  return {
    suite_id: suite.id,
    version: suite.version,
    frozen_at: now(),
    digest: digestOf(hashes),
    instance_hashes: hashes,
    packs: packs
      .filter((p) => suite.packs.includes(p.pack.id))
      .map((p) => ({ id: p.pack.id, version: p.pack.version, digest: p.digest }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export interface LockComparison {
  matches: boolean;
  missing: string[];
  unexpected: string[];
  digestChanged: boolean;
}

/** Verify a rebuilt suite against its committed lock. */
export function verifyAgainstLock(instances: readonly ScenarioInstance[], lock: SuiteLock): LockComparison {
  const built = new Set(instances.map((i) => i.hash));
  const locked = new Set(lock.instance_hashes);
  const missing = [...locked].filter((h) => !built.has(h)).sort();
  const unexpected = [...built].filter((h) => !locked.has(h)).sort();
  const digestChanged = digestOf([...built]) !== lock.digest;
  return { matches: missing.length === 0 && unexpected.length === 0 && !digestChanged, missing, unexpected, digestChanged };
}

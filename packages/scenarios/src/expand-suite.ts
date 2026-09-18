import type { ScenarioInstance, SuiteDef, VariationGrid } from "@trolleybench/spec";
import { expandFactors, expandVariations, instantiate, sampleDeterministic, seedFrom } from "@trolleybench/engine";
import type { LoadedPack } from "./load.js";

export interface SelectionFilter {
  packs?: string[];
  templates?: string[];
  tags?: string[];
  max_instances?: number;
  seed?: number;
}

/**
 * Expand packs into concrete instances. Instances are emitted in a deterministic
 * order - pack id, then template id, then cell, then variation - so that two machines
 * building the same suite produce the same list, not merely the same set.
 */
export function expandInstances(
  packs: readonly LoadedPack[],
  grid: VariationGrid,
  filter: SelectionFilter = {},
): ScenarioInstance[] {
  const variations = expandVariations(grid);
  const instances: ScenarioInstance[] = [];

  const selectedPacks = [...packs].sort((a, b) => a.pack.id.localeCompare(b.pack.id));
  for (const { pack } of selectedPacks) {
    if (filter.packs?.length && !filter.packs.includes(pack.id)) continue;

    const templates = [...pack.templates].sort((a, b) => a.id.localeCompare(b.id));
    for (const template of templates) {
      if (filter.templates?.length && !filter.templates.includes(template.id)) continue;
      if (filter.tags?.length && !filter.tags.some((tag) => template.tags.includes(tag))) continue;

      for (const cell of expandFactors(template)) {
        for (const variation of variations) {
          instances.push(instantiate({ pack_id: pack.id, template, cell, variation }));
        }
      }
    }
  }

  if (filter.max_instances !== undefined && instances.length > filter.max_instances) {
    // Key the sample on the design itself so the same cap yields the same subset,
    // independent of which machine expanded it.
    const seed = seedFrom(filter.seed ?? 0, String(instances.length), instances[0]?.hash ?? "");
    return sampleDeterministic(instances, filter.max_instances, seed);
  }
  return instances;
}

export function expandSuite(packs: readonly LoadedPack[], suite: SuiteDef): ScenarioInstance[] {
  return expandInstances(packs, suite.variations, {
    packs: suite.packs,
    templates: suite.templates,
    tags: suite.tags,
  });
}

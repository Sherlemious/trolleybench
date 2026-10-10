import type { HumanBaseline } from "@trolleybench/spec";

/** Client-safe: the results filters render these, and lib/sources reads the filesystem. */
export const MEASURE_LABEL: Record<HumanBaseline["measure"], string> = {
  permissible: "judged it permissible",
  should_act: "said the agent should act",
  would_act: "said they would act",
  acceptability_rating: "rated acceptability",
};

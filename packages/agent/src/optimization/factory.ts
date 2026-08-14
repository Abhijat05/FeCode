import type { TokenOptimizer } from "./types.js";
import {
  DefaultTokenOptimizer,
  type DefaultTokenOptimizerOptions
} from "./defaultOptimizer.js";
import {
  PonytailTokenOptimizer,
  type PonytailOptimizerOptions
} from "./providers/ponytail/ponytailOptimizer.js";

export function createTokenOptimizer(
  type?: string,
  options?: DefaultTokenOptimizerOptions & PonytailOptimizerOptions
): TokenOptimizer {
  const selected = type || process.env.FE_TOKEN_OPTIMIZER || "default";

  switch (selected.toLowerCase()) {
    case "ponytail":
      return new PonytailTokenOptimizer(options);
    case "disabled":
    case "none":
    case "off":
      return new DefaultTokenOptimizer({ ...options, enabled: false });
    case "default":
    default:
      return new DefaultTokenOptimizer(options);
  }
}

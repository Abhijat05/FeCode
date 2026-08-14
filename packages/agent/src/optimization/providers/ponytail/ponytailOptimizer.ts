import type {
  TokenOptimizationInput,
  TokenOptimizationResult,
  TokenOptimizer
} from "../../types.js";
import { DefaultTokenOptimizer } from "../../defaultOptimizer.js";
import { estimateTokens } from "../../estimator.js";

export interface PonytailOptimizerOptions {
  mode?: "lite" | "full" | "ultra" | "off";
  maxTokens?: number;
  enabled?: boolean;
}

export class PonytailTokenOptimizer implements TokenOptimizer {
  private readonly defaultOptimizer: DefaultTokenOptimizer;
  private readonly mode: "lite" | "full" | "ultra" | "off";
  private readonly enabled: boolean;
  private readonly maxTokens: number;

  constructor(options: PonytailOptimizerOptions = {}) {
    this.mode = options.mode ?? "full";
    this.enabled = options.enabled ?? true;
    this.maxTokens = options.maxTokens ?? 6000;
    this.defaultOptimizer = new DefaultTokenOptimizer({
      maxTokens: this.maxTokens,
      enabled: this.enabled
    });
  }

  public optimize(input: TokenOptimizationInput): TokenOptimizationResult {
    const text = input.text ?? "";
    const originalEstimatedTokens =
      input.estimatedTokens ?? estimateTokens(text);

    if (!text || text.trim().length === 0) {
      return this.defaultOptimizer.optimize(input);
    }

    if (!this.enabled || this.mode === "off") {
      return {
        text,
        originalEstimatedTokens,
        optimizedEstimatedTokens: originalEstimatedTokens,
        changed: false,
        strategy: "disabled",
        metrics: {
          originalTokens: originalEstimatedTokens,
          optimizedTokens: originalEstimatedTokens,
          tokensSaved: 0,
          reductionRatio: 0,
          strategy: "disabled"
        }
      };
    }

    try {
      // Apply Ponytail optimization logic
      const processed = this.applyPonytailTransform(text, this.mode);

      // Validate critical content preservation (Rules, Workflow, Anti-Patterns)
      if (!this.validateCriticalContent(text, processed)) {
        // If Ponytail transform corrupted critical content, fallback to default optimizer
        return this.defaultOptimizer.optimize(input);
      }

      // Enforce final budget and section priority via default optimizer fallback if still over budget
      const budget = input.maxTokens ?? this.maxTokens;
      const currentTokens = estimateTokens(processed);

      if (currentTokens > budget) {
        const reduced = this.defaultOptimizer.optimize({
          ...input,
          text: processed,
          estimatedTokens: currentTokens,
          maxTokens: budget
        });
        return {
          ...reduced,
          strategy: "ponytail+budget",
          metrics: {
            ...reduced.metrics,
            originalTokens: originalEstimatedTokens,
            tokensSaved: Math.max(0, originalEstimatedTokens - reduced.optimizedEstimatedTokens),
            reductionRatio:
              originalEstimatedTokens > 0
                ? Number(
                    (
                      (originalEstimatedTokens - reduced.optimizedEstimatedTokens) /
                      originalEstimatedTokens
                    ).toFixed(4)
                  )
                : 0,
            strategy: "ponytail+budget"
          }
        };
      }

      const optimizedTokens = estimateTokens(processed);
      const changed = processed !== text;
      const tokensSaved = Math.max(0, originalEstimatedTokens - optimizedTokens);
      const reductionRatio =
        originalEstimatedTokens > 0
          ? Number((tokensSaved / originalEstimatedTokens).toFixed(4))
          : 0;

      return {
        text: processed,
        originalEstimatedTokens,
        optimizedEstimatedTokens: optimizedTokens,
        changed,
        strategy: "ponytail",
        metrics: {
          originalTokens: originalEstimatedTokens,
          optimizedTokens,
          tokensSaved,
          reductionRatio,
          strategy: "ponytail"
        }
      };
    } catch {
      // Safe fallback on any error
      return this.defaultOptimizer.optimize(input);
    }
  }

  private applyPonytailTransform(
    text: string,
    mode: "lite" | "full" | "ultra"
  ): string {
    let result = text;

    if (mode === "ultra") {
      // In ultra mode, remove unnecessary non-critical commentary and trim repetitive blank lines
      result = result.replace(/\n\n(?:Note|Tip|Notice|Remark):[^\n]+/gi, "");
    }

    return result;
  }

  private validateCriticalContent(
    original: string,
    processed: string
  ): boolean {
    // Ensure all Rules, Workflow, Anti-Patterns in original are preserved in processed
    const criticalHeaders = [
      "#### Rules",
      "#### Workflow",
      "#### Anti-Patterns"
    ];
    for (const header of criticalHeaders) {
      if (original.includes(header) && !processed.includes(header)) {
        return false;
      }
    }
    return true;
  }
}

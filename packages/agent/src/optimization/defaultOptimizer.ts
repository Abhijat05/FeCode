import type {
  TokenOptimizationInput,
  TokenOptimizationResult,
  TokenOptimizer
} from "./types.js";
import { estimateTokens } from "./estimator.js";

export interface DefaultTokenOptimizerOptions {
  maxTokens?: number;
  enabled?: boolean;
}

interface ParsedSkillBlock {
  name: string;
  description: string;
  rules?: string;
  workflow?: string;
  antiPatterns?: string;
  instructions?: string;
  examples: string[];
}

export class DefaultTokenOptimizer implements TokenOptimizer {
  private readonly defaultMaxTokens: number;
  private readonly enabled: boolean;

  constructor(options: DefaultTokenOptimizerOptions = {}) {
    // Default context budget of 6000 estimated tokens
    this.defaultMaxTokens = options.maxTokens ?? 6000;
    this.enabled = options.enabled ?? true;
  }

  public optimize(input: TokenOptimizationInput): TokenOptimizationResult {
    const text = input.text ?? "";
    const originalEstimatedTokens =
      input.estimatedTokens ?? estimateTokens(text);

    if (!text || text.trim().length === 0) {
      return {
        text: "",
        originalEstimatedTokens: 0,
        optimizedEstimatedTokens: 0,
        changed: false,
        strategy: "none",
        metrics: {
          originalTokens: 0,
          optimizedTokens: 0,
          tokensSaved: 0,
          reductionRatio: 0,
          strategy: "none"
        }
      };
    }

    if (!this.enabled) {
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

    const budget = input.maxTokens ?? this.defaultMaxTokens;

    if (originalEstimatedTokens <= budget) {
      return {
        text,
        originalEstimatedTokens,
        optimizedEstimatedTokens: originalEstimatedTokens,
        changed: false,
        strategy: "none",
        metrics: {
          originalTokens: originalEstimatedTokens,
          optimizedTokens: originalEstimatedTokens,
          tokensSaved: 0,
          reductionRatio: 0,
          strategy: "none"
        }
      };
    }

    // Attempt structured section-priority optimization for skill context
    if (text.includes("### Skill:")) {
      const { optimizedText, changed } = this.optimizeSkillContext(text, budget);
      const optimizedTokens = estimateTokens(optimizedText);
      const tokensSaved = Math.max(0, originalEstimatedTokens - optimizedTokens);
      const reductionRatio =
        originalEstimatedTokens > 0
          ? Number((tokensSaved / originalEstimatedTokens).toFixed(4))
          : 0;

      return {
        text: optimizedText,
        originalEstimatedTokens,
        optimizedEstimatedTokens: optimizedTokens,
        changed,
        strategy: "section-priority",
        metrics: {
          originalTokens: originalEstimatedTokens,
          optimizedTokens,
          tokensSaved,
          reductionRatio,
          strategy: "section-priority"
        }
      };
    }

    // Generic text optimization (paragraph reduction)
    const { optimizedText, changed } = this.optimizeGenericText(text, budget);
    const optimizedTokens = estimateTokens(optimizedText);
    const tokensSaved = Math.max(0, originalEstimatedTokens - optimizedTokens);
    const reductionRatio =
      originalEstimatedTokens > 0
        ? Number((tokensSaved / originalEstimatedTokens).toFixed(4))
        : 0;

    return {
      text: optimizedText,
      originalEstimatedTokens,
      optimizedEstimatedTokens: optimizedTokens,
      changed,
      strategy: "budget-enforcement",
      metrics: {
        originalTokens: originalEstimatedTokens,
        optimizedTokens,
        tokensSaved,
        reductionRatio,
        strategy: "budget-enforcement"
      }
    };
  }

  private parseSkillContext(text: string): {
    header: string;
    blocks: ParsedSkillBlock[];
  } {
    const firstSkillIdx = text.indexOf("### Skill:");
    const header =
      firstSkillIdx > 0 ? text.slice(0, firstSkillIdx).trim() : "";
    const skillsText =
      firstSkillIdx >= 0 ? text.slice(firstSkillIdx) : text;

    // Split on skill boundaries
    const rawBlocks = skillsText
      .split(/(?:^|\n\n)(?=### Skill:)/g)
      .map((b) => b.trim())
      .filter((b) => b.startsWith("### Skill:"));

    const blocks: ParsedSkillBlock[] = rawBlocks.map((raw) => {
      // Extract title line
      const lines = raw.split("\n");
      const titleLine = lines[0];
      const name = titleLine.replace(/^### Skill:\s*/, "").trim();

      const afterTitle = lines.slice(1).join("\n").trim();
      // Split on section headers (#### Header)
      const sections = afterTitle.split(/(?=(?:^|\n)####\s+)/g);

      let description = "";
      let rules: string | undefined;
      let workflow: string | undefined;
      let antiPatterns: string | undefined;
      let instructions: string | undefined;
      const examples: string[] = [];

      for (const sec of sections) {
        const trimmed = sec.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith("#### Rules")) {
          rules = trimmed;
        } else if (trimmed.startsWith("#### Workflow")) {
          workflow = trimmed;
        } else if (trimmed.startsWith("#### Anti-Patterns")) {
          antiPatterns = trimmed;
        } else if (trimmed.startsWith("#### Instructions")) {
          instructions = trimmed;
        } else if (trimmed.startsWith("#### Examples")) {
          // Parse examples inside #### Examples
          const exBody = trimmed.replace(/^#### Examples\s*/, "").trim();
          if (exBody) {
            const rawExamples = exBody.split(/(?=(?:^|\n)\*\*[^*]+\*\*)/g);
            for (const re of rawExamples) {
              const cleaned = re.trim();
              if (cleaned) examples.push(cleaned);
            }
          }
        } else if (!trimmed.startsWith("####")) {
          description = trimmed;
        }
      }

      return {
        name,
        description,
        rules,
        workflow,
        antiPatterns,
        instructions,
        examples
      };
    });

    return { header, blocks };
  }

  private renderSkillContext(
    header: string,
    blocks: ParsedSkillBlock[]
  ): string {
    const renderedBlocks = blocks.map((b) => {
      const parts: string[] = [`### Skill: ${b.name}`];
      if (b.description) parts.push(b.description);
      if (b.rules) parts.push(b.rules);
      if (b.workflow) parts.push(b.workflow);
      if (b.antiPatterns) parts.push(b.antiPatterns);
      if (b.instructions) parts.push(b.instructions);
      if (b.examples && b.examples.length > 0) {
        parts.push(`#### Examples\n\n${b.examples.join("\n\n")}`);
      }
      return parts.join("\n\n");
    });

    const body = renderedBlocks.join("\n\n---\n\n");
    return header ? `${header}\n\n${body}` : body;
  }

  private optimizeSkillContext(
    text: string,
    budget: number
  ): { optimizedText: string; changed: boolean } {
    const { header, blocks } = this.parseSkillContext(text);
    if (blocks.length === 0) {
      return { optimizedText: text, changed: false };
    }

    let changed = false;
    let currentRender = this.renderSkillContext(header, blocks);

    // Reduction steps:
    // Step 1: Drop redundant examples (retain at most 1 example per skill), from lowest to highest priority skill
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (estimateTokens(currentRender) <= budget) break;
      if (blocks[i].examples.length > 1) {
        blocks[i].examples = [blocks[i].examples[0]];
        changed = true;
        currentRender = this.renderSkillContext(header, blocks);
      }
    }

    // Step 2: Drop all remaining examples, from lowest to highest priority skill
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (estimateTokens(currentRender) <= budget) break;
      if (blocks[i].examples.length > 0) {
        blocks[i].examples = [];
        changed = true;
        currentRender = this.renderSkillContext(header, blocks);
      }
    }

    // Step 3: Drop descriptions, from lowest to highest priority skill
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (estimateTokens(currentRender) <= budget) break;
      if (blocks[i].description) {
        blocks[i].description = "";
        changed = true;
        currentRender = this.renderSkillContext(header, blocks);
      }
    }

    // Step 4: Drop instructions, from lowest to highest priority skill
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (estimateTokens(currentRender) <= budget) break;
      if (blocks[i].instructions) {
        blocks[i].instructions = undefined;
        changed = true;
        currentRender = this.renderSkillContext(header, blocks);
      }
    }

    // NOTE: Rules, Workflow, and Anti-Patterns are NEVER dropped under any circumstances.

    return { optimizedText: currentRender, changed };
  }

  private optimizeGenericText(
    text: string,
    budget: number
  ): { optimizedText: string; changed: boolean } {
    const paragraphs = text.split("\n\n");
    if (paragraphs.length <= 1) {
      return { optimizedText: text, changed: false };
    }

    const currentParagraphs = [...paragraphs];
    let changed = false;

    while (
      currentParagraphs.length > 1 &&
      estimateTokens(currentParagraphs.join("\n\n")) > budget
    ) {
      currentParagraphs.pop();
      changed = true;
    }

    return {
      optimizedText: currentParagraphs.join("\n\n"),
      changed
    };
  }
}

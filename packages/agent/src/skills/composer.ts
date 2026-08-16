import type { ProjectContext } from "../project/types.js";
import type { Skill } from "./types.js";
import type { AgentPolicy } from "../policies/types.js";
import type { TokenOptimizer } from "../optimization/types.js";
import type { ExplorationResult } from "../exploration/types.js";
import { RepositoryExplorationFormatter } from "../exploration/formatter.js";
import type { CodeContextResult } from "../context/types.js";
import { CodeContextFormatter } from "../context/formatter.js";
import { DEFAULT_SYSTEM_PROMPT } from "../systemPrompt.js";
import { SkillContextFormatter } from "./formatter.js";

export interface ComposeSystemPromptOptions {
  baseSystemPrompt?: string;
  policies?: AgentPolicy[];
  projectContext?: ProjectContext;
  activeSkills?: Skill[];
  tokenOptimizer?: TokenOptimizer;
  activeSkillsContext?: string;
  explorationResult?: ExplorationResult | string;
  codeContext?: CodeContextResult | string;
  strategyGuidance?: string;
}

export function composeSystemPrompt(options: ComposeSystemPromptOptions = {}): string {
  const base = options.baseSystemPrompt || DEFAULT_SYSTEM_PROMPT;
  const sections: string[] = [base];

  if (options.policies && options.policies.length > 0) {
    const policyBlocks = options.policies.map((p) => {
      const lines = [`### Policy: ${p.name}`];
      if (p.description) {
        lines.push(p.description);
      }
      if (p.instructions && p.instructions.length > 0) {
        for (const inst of p.instructions) {
          lines.push(`- ${inst}`);
        }
      }
      return lines.join("\n");
    });
    sections.push(`## FeCode Agent Policies\n\n${policyBlocks.join("\n\n")}`);
  }

  if (options.projectContext) {
    const ctx = options.projectContext;
    const ctxLines: string[] = ["## Project Context"];

    if (ctx.framework) {
      ctxLines.push(
        `- Framework: ${ctx.framework}${ctx.frameworkVersion ? ` (${ctx.frameworkVersion})` : ""}`
      );
    }
    if (ctx.languages && ctx.languages.length > 0) {
      ctxLines.push(`- Languages: ${ctx.languages.join(", ")}`);
    }
    if (ctx.packageManager) {
      ctxLines.push(`- Package Manager: ${ctx.packageManager}`);
    }
    if (ctx.buildTool) {
      ctxLines.push(`- Build Tool: ${ctx.buildTool}`);
    } else if (ctx.buildTools && ctx.buildTools.length > 0) {
      ctxLines.push(`- Build Tool: ${ctx.buildTools.join(", ")}`);
    }
    if (ctx.testing && ctx.testing.length > 0) {
      ctxLines.push(`- Testing: ${ctx.testing.join(", ")}`);
    }
    if (ctx.lintTools && ctx.lintTools.length > 0) {
      ctxLines.push(`- Linting: ${ctx.lintTools.join(", ")}`);
    }
    if (ctx.formatTools && ctx.formatTools.length > 0) {
      ctxLines.push(`- Formatting: ${ctx.formatTools.join(", ")}`);
    }
    if (ctx.styling && ctx.styling.length > 0) {
      ctxLines.push(`- Styling: ${ctx.styling.join(", ")}`);
    }
    if (ctx.workspaces && ctx.workspaces.isMonorepo) {
      ctxLines.push(
        `- Workspaces: ${ctx.workspaces.type || "monorepo"}${
          ctx.workspaces.packages?.length
            ? ` (${ctx.workspaces.packages.join(", ")})`
            : ""
        }`
      );
    }
    if (ctx.importantDirectories && ctx.importantDirectories.length > 0) {
      ctxLines.push(`- Important Directories: ${ctx.importantDirectories.join(", ")}`);
    } else {
      if (ctx.structure?.sourceDirectories?.length > 0) {
        ctxLines.push(`- Source Directories: ${ctx.structure.sourceDirectories.join(", ")}`);
      }
      if (ctx.structure?.componentDirectories?.length > 0) {
        ctxLines.push(`- Component Directories: ${ctx.structure.componentDirectories.join(", ")}`);
      }
    }

    if (ctxLines.length > 1) {
      sections.push(ctxLines.join("\n"));
    }
  }

  if (options.explorationResult) {
    if (typeof options.explorationResult === "string") {
      if (options.explorationResult.trim().length > 0) {
        sections.push(options.explorationResult.trim());
      }
    } else {
      const formatter = new RepositoryExplorationFormatter();
      const formatted = formatter.format(options.explorationResult);
      if (formatted.trim().length > 0) {
        sections.push(formatted.trim());
      }
    }
  }

  if (options.codeContext) {
    if (typeof options.codeContext === "string") {
      if (options.codeContext.trim().length > 0) {
        sections.push(options.codeContext.trim());
      }
    } else {
      const formatter = new CodeContextFormatter();
      const formatted = formatter.format(options.codeContext);
      if (formatted.trim().length > 0) {
        sections.push(formatted.trim());
      }
    }
  }

  if (options.activeSkillsContext) {
    sections.push(options.activeSkillsContext);
  } else if (options.activeSkills && options.activeSkills.length > 0) {
    const formatter = new SkillContextFormatter();
    const result = formatter.format(options.activeSkills);
    if (options.tokenOptimizer) {
      const optimized = options.tokenOptimizer.optimize({
        text: result.content,
        metadata: { activeSkills: options.activeSkills.map((s) => s.name) }
      });
      sections.push(optimized.text);
    } else {
      sections.push(result.content);
    }
  }

  if (options.strategyGuidance && options.strategyGuidance.trim().length > 0) {
    sections.push(`## Execution Strategy Guidance\n\n${options.strategyGuidance.trim()}`);
  }

  return sections.join("\n\n");
}

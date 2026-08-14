import type { ProjectContext } from "../project/types.js";
import type { Skill } from "./types.js";
import type { TokenOptimizer } from "../optimization/types.js";
import { DEFAULT_SYSTEM_PROMPT } from "../systemPrompt.js";
import { SkillContextFormatter } from "./formatter.js";

export interface ComposeSystemPromptOptions {
  baseSystemPrompt?: string;
  projectContext?: ProjectContext;
  activeSkills?: Skill[];
  tokenOptimizer?: TokenOptimizer;
  activeSkillsContext?: string;
}

export function composeSystemPrompt(options: ComposeSystemPromptOptions = {}): string {
  const base = options.baseSystemPrompt || DEFAULT_SYSTEM_PROMPT;
  const sections: string[] = [base];

  if (options.projectContext) {
    const ctx = options.projectContext;
    const ctxLines: string[] = ["## Project Context"];

    if (ctx.framework) {
      ctxLines.push(
        `- Framework: ${ctx.framework}${ctx.frameworkVersion ? ` (${ctx.frameworkVersion})` : ""}`
      );
    }
    if (ctx.buildTool) {
      ctxLines.push(`- Build Tool: ${ctx.buildTool}`);
    }
    if (ctx.languages.length > 0) {
      ctxLines.push(`- Languages: ${ctx.languages.join(", ")}`);
    }
    if (ctx.styling.length > 0) {
      ctxLines.push(`- Styling: ${ctx.styling.join(", ")}`);
    }
    if (ctx.testing.length > 0) {
      ctxLines.push(`- Testing: ${ctx.testing.join(", ")}`);
    }
    if (ctx.packageManager) {
      ctxLines.push(`- Package Manager: ${ctx.packageManager}`);
    }
    if (ctx.structure.sourceDirectories.length > 0) {
      ctxLines.push(`- Source Directories: ${ctx.structure.sourceDirectories.join(", ")}`);
    }
    if (ctx.structure.componentDirectories.length > 0) {
      ctxLines.push(`- Component Directories: ${ctx.structure.componentDirectories.join(", ")}`);
    }

    if (ctxLines.length > 1) {
      sections.push(ctxLines.join("\n"));
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

  return sections.join("\n\n");
}

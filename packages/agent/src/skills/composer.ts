import type { ProjectContext } from "../project/types.js";
import type { Skill } from "./types.js";
import { DEFAULT_SYSTEM_PROMPT } from "../systemPrompt.js";

export interface ComposeSystemPromptOptions {
  baseSystemPrompt?: string;
  projectContext?: ProjectContext;
  activeSkills?: Skill[];
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
    if (ctx.sourceDirectories.length > 0) {
      ctxLines.push(`- Source Directories: ${ctx.sourceDirectories.join(", ")}`);
    }
    if (ctx.componentDirectories.length > 0) {
      ctxLines.push(`- Component Directories: ${ctx.componentDirectories.join(", ")}`);
    }

    if (ctxLines.length > 1) {
      sections.push(ctxLines.join("\n"));
    }
  }

  if (options.activeSkills && options.activeSkills.length > 0) {
    const skillLines: string[] = ["## Active Frontend Skills"];
    for (const skill of options.activeSkills) {
      skillLines.push(`[${skill.name}]\n${skill.instructions}`);
    }
    sections.push(skillLines.join("\n\n"));
  }

  return sections.join("\n\n");
}

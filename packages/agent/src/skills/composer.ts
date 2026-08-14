import type { ProjectContext } from "../project/types.js";
import type { Skill } from "./types.js";
import { DEFAULT_SYSTEM_PROMPT } from "../systemPrompt.js";

export interface ComposeSystemPromptOptions {
  baseSystemPrompt?: string;
  projectContext?: ProjectContext;
  activeSkills?: Skill[];
}

export function formatSkill(skill: Skill): string {
  const lines: string[] = [`### ${skill.name}`];
  
  if (skill.description) {
    lines.push(skill.description);
  }

  if (skill.instructions && skill.instructions.length > 0) {
    for (const inst of skill.instructions) {
      lines.push(`- ${inst}`);
    }
  }

  if (skill.rules && skill.rules.length > 0) {
    lines.push("\nRules:");
    for (const rule of skill.rules) {
      lines.push(`- ${rule}`);
    }
  }

  if (skill.antiPatterns && skill.antiPatterns.length > 0) {
    lines.push("\nAvoid:");
    for (const ap of skill.antiPatterns) {
      lines.push(`- ${ap}`);
    }
  }

  return lines.join("\n");
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

  if (options.activeSkills && options.activeSkills.length > 0) {
    const skillBlocks = options.activeSkills.map((skill) => formatSkill(skill));
    sections.push(`## Active FeCode Skills\n\n${skillBlocks.join("\n\n")}`);
  }

  return sections.join("\n\n");
}

import type { ProjectContext } from "../project/types.js";
import type { Skill } from "./types.js";
import { DEFAULT_SYSTEM_PROMPT } from "../systemPrompt.js";

export interface ComposeSystemPromptOptions {
  baseSystemPrompt?: string;
  projectContext?: ProjectContext;
  activeSkills?: Skill[];
}

export function formatSkill(skill: Skill): string {
  const lines: string[] = [`### Skill: ${skill.name} (v${skill.version})`, skill.description];

  if (skill.activation?.when && skill.activation.when.length > 0) {
    lines.push("When relevant:");
    for (const w of skill.activation.when) {
      lines.push(`- ${w}`);
    }
  }

  if (skill.instructions && skill.instructions.length > 0) {
    lines.push("Core instructions:");
    for (const inst of skill.instructions) {
      lines.push(`- ${inst}`);
    }
  }

  if (skill.workflow && skill.workflow.length > 0) {
    lines.push("Workflow:");
    for (const step of skill.workflow) {
      lines.push(step.startsWith("- ") || /^\d+\./.test(step) ? step : `- ${step}`);
    }
  }

  if (skill.rules && skill.rules.length > 0) {
    lines.push("Rules:");
    for (const rule of skill.rules) {
      lines.push(`- ${rule}`);
    }
  }

  if (skill.antiPatterns && skill.antiPatterns.length > 0) {
    lines.push("Avoid:");
    for (const ap of skill.antiPatterns) {
      lines.push(`- ${ap}`);
    }
  }

  if (skill.examples && skill.examples.length > 0) {
    lines.push("Examples:");
    for (const ex of skill.examples) {
      lines.push(`- Title: ${ex.title}`);
      if (ex.description) {
        lines.push(`  Description: ${ex.description}`);
      }
      lines.push(`  ${ex.example}`);
    }
  }

  if (skill.references && skill.references.length > 0) {
    lines.push("References:");
    for (const ref of skill.references) {
      lines.push(`- ${ref.name}: ${ref.path}${ref.description ? ` (${ref.description})` : ""}`);
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
    sections.push(`## Active Frontend Skills\n\n${skillBlocks.join("\n\n")}`);
  }

  return sections.join("\n\n");
}

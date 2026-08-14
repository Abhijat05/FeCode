import type { Skill, SkillExample } from "./types.js";
import { estimateTokens } from "../optimization/estimator.js";

export interface SkillContextDiagnostics {
  activeSkills: string[];
  estimatedTokens: number;
  budget: number;
  wasReduced: boolean;
  sectionsRemoved: Array<{ skill: string; section: string }>;
}

export interface FormattedSkillContext {
  content: string;
  diagnostics: SkillContextDiagnostics;
}

export interface SkillContextFormatterOptions {
  maxTokens?: number;
}

export class SkillContextFormatter {
  private readonly maxTokens: number;

  constructor(options?: SkillContextFormatterOptions) {
    // Default context budget of 6000 tokens
    this.maxTokens = options?.maxTokens ?? 6000;
  }

  public estimateTokens(text: string): number {
    return estimateTokens(text);
  }

  public format(skills: Skill[]): FormattedSkillContext {
    if (skills.length === 0) {
      return {
        content: "",
        diagnostics: {
          activeSkills: [],
          estimatedTokens: 0,
          budget: this.maxTokens,
          wasReduced: false,
          sectionsRemoved: []
        }
      };
    }

    // Clone data to allow independent mutation (dropping sections)
    const representations = skills.map((s) => ({
      name: s.name,
      description: s.description,
      instructions: [...(s.instructions || [])],
      workflow: [...(s.workflow || [])],
      rules: [...(s.rules || [])],
      antiPatterns: [...(s.antiPatterns || [])],
      examples: [...(s.examples || [])]
    }));

    const diagnostics: SkillContextDiagnostics = {
      activeSkills: skills.map(s => s.name),
      estimatedTokens: 0,
      budget: this.maxTokens,
      wasReduced: false,
      sectionsRemoved: []
    };

    let content = this.render(representations);
    let tokens = this.estimateTokens(content);

    // Reduction loop
    // Priority of dropping:
    // 1. Redundant examples (keep at most 1 example per skill), starting from lowest priority (last) skill
    // 2. All examples, starting from lowest priority
    // 3. Descriptions, starting from lowest priority
    // 4. Instructions, starting from lowest priority
    // We NEVER drop Rules, Workflow, or Anti-Patterns
    
    const steps = [
      // Drop redundant examples
      ...representations.map((rep, index) => () => {
        // Reverse order (lowest priority first) -> actual index is (length - 1 - index)
        const target = representations[representations.length - 1 - index];
        if (target.examples.length > 1) {
          const removedCount = target.examples.length - 1;
          target.examples = [target.examples[0]];
          diagnostics.sectionsRemoved.push({ skill: target.name, section: `redundant-examples (${removedCount})` });
          return true;
        }
        return false;
      }),
      // Drop ALL examples
      ...representations.map((rep, index) => () => {
        const target = representations[representations.length - 1 - index];
        if (target.examples.length > 0) {
          target.examples = [];
          diagnostics.sectionsRemoved.push({ skill: target.name, section: "examples" });
          return true;
        }
        return false;
      }),
      // Drop description
      ...representations.map((rep, index) => () => {
        const target = representations[representations.length - 1 - index];
        if (target.description) {
          target.description = "";
          diagnostics.sectionsRemoved.push({ skill: target.name, section: "description" });
          return true;
        }
        return false;
      }),
      // Drop instructions
      ...representations.map((rep, index) => () => {
        const target = representations[representations.length - 1 - index];
        if (target.instructions.length > 0) {
          target.instructions = [];
          diagnostics.sectionsRemoved.push({ skill: target.name, section: "instructions" });
          return true;
        }
        return false;
      })
    ];

    for (const step of steps) {
      if (tokens <= this.maxTokens) break;
      const reduced = step();
      if (reduced) {
        diagnostics.wasReduced = true;
        content = this.render(representations);
        tokens = this.estimateTokens(content);
      }
    }

    diagnostics.estimatedTokens = tokens;

    return {
      content,
      diagnostics
    };
  }

  private render(reps: Array<{
    name: string;
    description: string;
    instructions: string[];
    workflow: string[];
    rules: string[];
    antiPatterns: string[];
    examples: SkillExample[];
  }>): string {
    const blocks = reps.map(rep => {
      const lines = [`### Skill: ${rep.name}`];
      
      if (rep.description) {
        lines.push(rep.description);
      }

      if (rep.rules && rep.rules.length > 0) {
        lines.push(`\n#### Rules`);
        rep.rules.forEach((r: string) => lines.push(`- ${r}`));
      }

      if (rep.workflow && rep.workflow.length > 0) {
        lines.push(`\n#### Workflow`);
        rep.workflow.forEach((w: string) => lines.push(`- ${w}`));
      }

      if (rep.antiPatterns && rep.antiPatterns.length > 0) {
        lines.push(`\n#### Anti-Patterns`);
        rep.antiPatterns.forEach((ap: string) => lines.push(`- ${ap}`));
      }

      if (rep.instructions && rep.instructions.length > 0) {
        lines.push(`\n#### Instructions`);
        rep.instructions.forEach((inst: string) => lines.push(`- ${inst}`));
      }

      if (rep.examples && rep.examples.length > 0) {
        lines.push(`\n#### Examples`);
        rep.examples.forEach((ex: SkillExample) => {
          lines.push(`\n**${ex.title}**`);
          if (ex.description) lines.push(ex.description);
          lines.push(`\`\`\`\n${ex.example}\n\`\`\``);
        });
      }

      return lines.join("\n");
    });

    return `## Active FeCode Skills\n\n${blocks.join("\n\n---\n\n")}`;
  }
}

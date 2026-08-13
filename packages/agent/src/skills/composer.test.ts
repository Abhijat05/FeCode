import { describe, it, expect } from "vitest";
import { composeSystemPrompt } from "./composer.js";
import { DEFAULT_SYSTEM_PROMPT } from "../systemPrompt.js";
import type { ProjectContext } from "../project/types.js";
import type { Skill } from "./types.js";

describe("composeSystemPrompt with Skill Spec v2", () => {
  const mockContext: ProjectContext = {
    projectRoot: "/test",
    languages: ["typescript"],
    framework: "react",
    frameworkVersion: "18.3.1",
    buildTool: "vite",
    styling: ["tailwind"],
    testing: ["vitest"],
    packageManager: "npm",
    sourceDirectories: ["src"],
    componentDirectories: ["src/components"],
    configFiles: []
  };

  const mockStructuredSkill: Skill = {
    name: "frontend-design",
    description: "UI design best practices",
    category: "frontend",
    version: "2.0.0",
    activation: {
      when: ["Designing UI components"],
      notWhen: ["Writing database queries"]
    },
    instructions: ["Maintain clean visual hierarchy."],
    workflow: ["1. Establish layout grid", "2. Style interactive states"],
    rules: ["Never use unconstrained massive typography."],
    antiPatterns: ["Avoid icon-stuffed bento boxes"],
    examples: [
      {
        title: "Primary Button",
        example: "<button className=\"px-4 py-2 bg-blue-600 text-white rounded\">Submit</button>"
      }
    ],
    references: [
      {
        name: "Design System Guide",
        path: "docs/design.md"
      }
    ]
  };

  it("formats structured skill sections cleanly without empty headers", () => {
    const prompt = composeSystemPrompt({
      baseSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      projectContext: mockContext,
      activeSkills: [mockStructuredSkill]
    });

    expect(prompt).toContain("### Skill: frontend-design (v2.0.0)");
    expect(prompt).toContain("When relevant:");
    expect(prompt).toContain("- Designing UI components");
    expect(prompt).toContain("Core instructions:");
    expect(prompt).toContain("- Maintain clean visual hierarchy.");
    expect(prompt).toContain("Workflow:");
    expect(prompt).toContain("1. Establish layout grid");
    expect(prompt).toContain("Rules:");
    expect(prompt).toContain("- Never use unconstrained massive typography.");
    expect(prompt).toContain("Avoid:");
    expect(prompt).toContain("- Avoid icon-stuffed bento boxes");
    expect(prompt).toContain("Examples:");
    expect(prompt).toContain("Primary Button");
    expect(prompt).toContain("References:");
    expect(prompt).toContain("Design System Guide: docs/design.md");
  });

  it("omits empty optional sections cleanly when skill optional fields are undefined", () => {
    const simpleSkill: Skill = {
      name: "simple-skill",
      description: "Simple skill description",
      category: "frontend",
      version: "1.0.0",
      instructions: ["Simple instruction 1"]
    };

    const prompt = composeSystemPrompt({
      baseSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      activeSkills: [simpleSkill]
    });

    expect(prompt).toContain("### Skill: simple-skill (v1.0.0)");
    expect(prompt).toContain("Core instructions:");
    expect(prompt).toContain("- Simple instruction 1");

    expect(prompt).not.toContain("When relevant:");
    expect(prompt).not.toContain("Workflow:");
    expect(prompt).not.toContain("Rules:");
    expect(prompt).not.toContain("Avoid:");
    expect(prompt).not.toContain("Examples:");
    expect(prompt).not.toContain("References:");
  });
});

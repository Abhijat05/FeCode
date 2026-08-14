import { describe, it, expect } from "vitest";
import { composeSystemPrompt } from "./composer.js";
import { DEFAULT_SYSTEM_PROMPT } from "../systemPrompt.js";
import type { ProjectContext } from "../project/types.js";
import type { Skill } from "./types.js";

describe("composeSystemPrompt with Skill Spec v2", () => {
  const mockContext: ProjectContext = {
    projectRoot: "/mock",
    projectType: "frontend",
    languages: ["typescript"],
    framework: "react",
    frameworks: ["react"],
    frameworkVersion: "18.0.0",
    buildTool: "vite",
    styling: ["tailwind"],
    testing: ["vitest"],
    packageManager: "npm",
    structure: {
      sourceDirectories: ["src"],
      componentDirectories: ["src/components"],
      routeDirectories: [],
      testDirectories: [],
      assetDirectories: []
    },
    scripts: {},
    configuration: {
      framework: [],
      styling: [],
      build: [],
      testing: []
    }
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

    expect(prompt).toContain("### Skill: frontend-design");
    expect(prompt).toContain("UI design best practices");
    expect(prompt).toContain("- Maintain clean visual hierarchy.");
    expect(prompt).toContain("#### Rules");
    expect(prompt).toContain("- Never use unconstrained massive typography.");
    expect(prompt).toContain("#### Anti-Patterns");
    expect(prompt).toContain("- Avoid icon-stuffed bento boxes");
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

    expect(prompt).toContain("### Skill: simple-skill");
    expect(prompt).toContain("Simple skill description");
    expect(prompt).toContain("- Simple instruction 1");

    expect(prompt).not.toContain("#### Rules");
    expect(prompt).not.toContain("#### Anti-Patterns");
  });
});

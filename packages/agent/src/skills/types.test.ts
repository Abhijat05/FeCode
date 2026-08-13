import { describe, it, expect } from "vitest";
import type { Skill } from "./types.js";

describe("Skill Specification v2 Types", () => {
  it("supports structured optional fields (activation, workflow, rules, antiPatterns, examples, references)", () => {
    const skill: Skill = {
      name: "custom-skill",
      description: "Custom test skill",
      category: "frontend",
      version: "2.0.0",
      activation: {
        when: ["building UI components"],
        notWhen: ["writing backend APIs"]
      },
      instructions: ["Core rule 1", "Core rule 2"],
      workflow: ["1. Plan layout", "2. Implement state"],
      rules: ["Rule A", "Rule B"],
      antiPatterns: ["Avoid inline styles"],
      examples: [
        {
          title: "Button Component",
          description: "Example React button",
          example: "<button className=\"px-4 py-2\">Click</button>"
        }
      ],
      references: [
        {
          name: "React Docs",
          path: "docs/react.md",
          description: "Official documentation"
        }
      ]
    };

    expect(skill.name).toBe("custom-skill");
    expect(skill.activation?.when).toEqual(["building UI components"]);
    expect(skill.instructions).toHaveLength(2);
    expect(skill.workflow).toHaveLength(2);
    expect(skill.examples?.[0].title).toBe("Button Component");
    expect(skill.references?.[0].path).toBe("docs/react.md");
  });
});

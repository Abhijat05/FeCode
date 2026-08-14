import { describe, it, expect } from "vitest";
import { SkillContextFormatter } from "./formatter.js";
import type { Skill } from "./types.js";

describe("SkillContextFormatter", () => {
  const dummySkill1: Skill = {
    name: "react",
    version: "1.0",
    category: "framework",
    description: "React UI",
    instructions: ["Use hooks", "Do not mutate"],
    rules: ["Always clean up effects"],
    antiPatterns: ["Index as key"],
    examples: [
      { title: "Good Example", example: "const x = 1;" },
      { title: "Bad Example", example: "const x = 2;" }
    ]
  };

  const dummySkill2: Skill = {
    name: "tailwind",
    version: "1.0",
    category: "styling",
    description: "Tailwind CSS",
    instructions: ["Use utility classes"],
    examples: [
      { title: "Spacing", example: "p-4 m-2" }
    ]
  };

  it("Basic Formatting - formats one skill correctly without metadata", () => {
    const formatter = new SkillContextFormatter();
    const result = formatter.format([dummySkill1]);
    
    expect(result.content).toContain("### Skill: react");
    expect(result.content).toContain("React UI");
    expect(result.content).toContain("#### Rules");
    expect(result.content).toContain("- Always clean up effects");
    expect(result.content).toContain("#### Instructions");
    expect(result.content).toContain("- Use hooks");
    expect(result.content).toContain("#### Anti-Patterns");
    expect(result.content).toContain("- Index as key");
    expect(result.content).toContain("#### Examples");
    expect(result.content).toContain("**Good Example**");
    expect(result.content).toContain("const x = 1;");
    
    // Internal metadata should not be present
    expect(result.content).not.toContain("version");
    expect(result.content).not.toContain("category");
  });

  it("Multiple Skills - renders in exact activation order", () => {
    const formatter = new SkillContextFormatter();
    const result = formatter.format([dummySkill1, dummySkill2]);
    
    const idx1 = result.content.indexOf("### Skill: react");
    const idx2 = result.content.indexOf("### Skill: tailwind");
    expect(idx1).toBeLessThan(idx2);
    expect(idx1).toBeGreaterThan(-1);
  });

  it("Empty Skills - handles safely", () => {
    const emptySkill: Skill = {
      name: "empty",
      version: "1.0",
      category: "frontend",
      description: "",
      instructions: []
    };
    const formatter = new SkillContextFormatter();
    const result = formatter.format([emptySkill]);
    expect(result.content).toContain("### Skill: empty");
    expect(result.content).not.toContain("#### Rules");
    expect(result.content).not.toContain("#### Instructions");
  });

  it("Budget - reduces content starting from lowest priority examples", () => {
    // Artificial small budget to force reduction
    const formatter = new SkillContextFormatter({ maxTokens: 50 });
    const result = formatter.format([dummySkill1, dummySkill2]);
    
    // Was reduced
    expect(result.diagnostics.wasReduced).toBe(true);
    expect(result.diagnostics.sectionsRemoved.length).toBeGreaterThan(0);
    
    // Since dummySkill2 is lower priority, its examples should be dropped first
    expect(result.diagnostics.sectionsRemoved.some(s => s.skill === "tailwind" && s.section === "examples")).toBe(true);
    
    // Core rules should NEVER be dropped
    expect(result.content).toContain("Always clean up effects");
  });

  it("Priority - redundant examples are dropped first", () => {
    // Just enough budget to force dropping redundant examples but not all examples
    const formatter = new SkillContextFormatter({ maxTokens: 60 });
    const result = formatter.format([dummySkill1]);
    
    // React has 2 examples. The redundant one (Bad Example) should be dropped
    expect(result.diagnostics.wasReduced).toBe(true);
    expect(result.diagnostics.sectionsRemoved.some(s => s.section.startsWith("redundant-examples"))).toBe(true);
    
    // First example kept
    expect(result.content).toContain("Good Example");
    // Second example dropped
    expect(result.content).not.toContain("Bad Example");
  });

  it("Determinism - same input produces same output", () => {
    const formatter = new SkillContextFormatter();
    const r1 = formatter.format([dummySkill1, dummySkill2]);
    const r2 = formatter.format([dummySkill1, dummySkill2]);
    expect(r1.content).toBe(r2.content);
  });

  it("Token Estimate is deterministic", () => {
    const formatter = new SkillContextFormatter();
    const estimate = formatter.estimateTokens("1234");
    expect(estimate).toBe(1);
    expect(formatter.estimateTokens("12345")).toBe(2);
  });
});

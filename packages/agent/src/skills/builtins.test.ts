import { describe, it, expect } from "vitest";
import { BUILTIN_SKILLS } from "./builtins/index.js";
import { DefaultSkillRegistry } from "./registry.js";
import { registerBuiltinSkills } from "./builtins/index.js";

describe("Built-in Skills Spec v2", () => {
  it("verifies every built-in skill has valid metadata, non-empty instructions, and valid categories", () => {
    const validCategories = new Set([
      "frontend",
      "framework",
      "styling",
      "testing",
      "accessibility",
      "architecture"
    ]);

    expect(BUILTIN_SKILLS.length).toBeGreaterThan(0);

    for (const skill of BUILTIN_SKILLS) {
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.version).toBeTruthy();
      expect(skill.instructions).toBeDefined();
      expect(Array.isArray(skill.instructions)).toBe(true);
      expect(skill.instructions.length).toBeGreaterThan(0);
      expect(skill.instructions.join("\n").length).toBeGreaterThan(20);
      expect(validCategories.has(skill.category)).toBe(true);
    }
  });

  it("populates SkillRegistry cleanly using registerBuiltinSkills", () => {
    const registry = new DefaultSkillRegistry();
    registerBuiltinSkills(registry);

    expect(registry.list().length).toBe(BUILTIN_SKILLS.length);
    expect(registry.get("frontend-design")).toBeDefined();
    expect(registry.get("typescript-frontend")).toBeDefined();
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { DefaultSkillRegistry } from "./registry.js";
import type { Skill } from "./types.js";

describe("DefaultSkillRegistry", () => {
  let registry: DefaultSkillRegistry;

  const mockSkill1: Skill = {
    name: "react",
    description: "React best practices",
    category: "framework",
    version: "1.0.0",
    instructions: "Use functional components."
  };

  const mockSkill2: Skill = {
    name: "tailwind",
    description: "Tailwind CSS guidelines",
    category: "styling",
    version: "1.0.0",
    instructions: "Use utility classes."
  };

  beforeEach(() => {
    registry = new DefaultSkillRegistry();
  });

  it("registers, checks, gets, and lists skills", () => {
    expect(registry.has("react")).toBe(false);

    registry.register(mockSkill1);
    registry.register(mockSkill2);

    expect(registry.has("react")).toBe(true);
    expect(registry.get("react")).toBe(mockSkill1);
    expect(registry.get("tailwind")).toBe(mockSkill2);

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.name)).toEqual(["react", "tailwind"]);
  });

  it("handles duplicate registrations cleanly by updating to the latest skill", () => {
    registry.register(mockSkill1);

    const updatedSkill: Skill = {
      ...mockSkill1,
      version: "2.0.0",
      instructions: "Use React 18 hooks."
    };

    registry.register(updatedSkill);
    expect(registry.list()).toHaveLength(1);
    expect(registry.get("react")?.version).toBe("2.0.0");
    expect(registry.get("react")?.instructions).toBe("Use React 18 hooks.");
  });
});

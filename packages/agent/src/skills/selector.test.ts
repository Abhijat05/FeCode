import { describe, it, expect, beforeEach } from "vitest";
import { DefaultSkillRegistry } from "./registry.js";
import { registerBuiltinSkills } from "./builtins/index.js";
import { resolveActiveSkills } from "./selector.js";

describe("resolveActiveSkills", () => {
  let registry: DefaultSkillRegistry;

  beforeEach(() => {
    registry = new DefaultSkillRegistry();
    registerBuiltinSkills(registry);
  });

  it("combines recommended and user-selected skills cleanly, removing duplicates and filtering unknown skills", () => {
    const recommended = ["frontend-design", "react"];
    const userSelected = ["react", "tailwind", "unknown-skill"];

    const active = resolveActiveSkills({
      registry,
      recommended,
      userSelected
    });

    const activeNames = active.map((s) => s.name);
    expect(activeNames).toEqual(["frontend-design", "react", "tailwind"]);
    expect(activeNames).not.toContain("unknown-skill");
  });
});

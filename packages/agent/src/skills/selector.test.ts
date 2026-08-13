import { describe, it, expect, beforeEach } from "vitest";
import { DefaultSkillRegistry } from "./registry.js";
import { registerBuiltinSkills } from "./builtins/index.js";
import { SkillLoader } from "./loader.js";
import { resolveActiveSkills } from "./selector.js";

describe("resolveActiveSkills", () => {
  let registry: DefaultSkillRegistry;

  beforeEach(async () => {
    registry = new DefaultSkillRegistry();
    registerBuiltinSkills(registry);
    const loader = new SkillLoader();
    const skills = await loader.discoverSkills(loader.getBuiltinSkillsDir());
    for (const skill of skills) {
      registry.register(skill);
    }
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
    // Sort to make the assertion deterministic, since Set/loading order could vary
    expect(activeNames.sort()).toEqual(["frontend-design", "react", "tailwind"].sort());
    expect(activeNames).not.toContain("unknown-skill");
  });
});

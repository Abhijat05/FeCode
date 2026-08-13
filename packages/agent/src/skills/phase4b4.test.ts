import { describe, it, expect } from "vitest";
import { SkillLoader } from "./loader.js";

describe("SKILL.md Package: responsive-design", () => {
  const loader = new SkillLoader();

  it("loads from the canonical package path", async () => {
    const skill = await loader.loadBuiltinSkill("responsive-design");
    expect(skill.name).toBe("responsive-design");
    expect(skill.category).toBe("frontend");
    expect(skill.version).toBe("1.0.0");
    expect(skill.description.length).toBeGreaterThan(30);
  });

  it("has non-trivial activation metadata", async () => {
    const skill = await loader.loadBuiltinSkill("responsive-design");
    expect(skill.activation?.when.length).toBeGreaterThan(0);
    expect(skill.activation?.notWhen?.length).toBeGreaterThan(0);
  });

  it("has non-trivial core instructions", async () => {
    const skill = await loader.loadBuiltinSkill("responsive-design");
    expect(skill.instructions.length).toBeGreaterThan(2);
  });

  it("has a workflow", async () => {
    const skill = await loader.loadBuiltinSkill("responsive-design");
    expect(skill.workflow?.length).toBeGreaterThan(0);
  });

  it("has anti-patterns (avoid section)", async () => {
    const skill = await loader.loadBuiltinSkill("responsive-design");
    expect(skill.antiPatterns?.length).toBeGreaterThan(0);
  });

  it("has examples", async () => {
    const skill = await loader.loadBuiltinSkill("responsive-design");
    expect(skill.examples?.length).toBeGreaterThan(0);
  });
});

describe("SKILL.md Package: frontend-debugging", () => {
  const loader = new SkillLoader();

  it("loads from the canonical package path", async () => {
    const skill = await loader.loadBuiltinSkill("frontend-debugging");
    expect(skill.name).toBe("frontend-debugging");
    expect(skill.category).toBe("frontend");
    expect(skill.version).toBe("1.0.0");
    expect(skill.description.length).toBeGreaterThan(30);
  });

  it("has non-trivial activation metadata", async () => {
    const skill = await loader.loadBuiltinSkill("frontend-debugging");
    expect(skill.activation?.when.length).toBeGreaterThan(0);
    expect(skill.activation?.notWhen?.length).toBeGreaterThan(0);
  });

  it("has non-trivial core instructions", async () => {
    const skill = await loader.loadBuiltinSkill("frontend-debugging");
    expect(skill.instructions.length).toBeGreaterThan(2);
  });

  it("has a workflow", async () => {
    const skill = await loader.loadBuiltinSkill("frontend-debugging");
    expect(skill.workflow?.length).toBeGreaterThan(0);
  });

  it("has anti-patterns (avoid section)", async () => {
    const skill = await loader.loadBuiltinSkill("frontend-debugging");
    expect(skill.antiPatterns?.length).toBeGreaterThan(0);
  });

  it("has examples", async () => {
    const skill = await loader.loadBuiltinSkill("frontend-debugging");
    expect(skill.examples?.length).toBeGreaterThan(0);
  });
});

describe("SKILL.md Package: ui-review", () => {
  const loader = new SkillLoader();

  it("loads from the canonical package path", async () => {
    const skill = await loader.loadBuiltinSkill("ui-review");
    expect(skill.name).toBe("ui-review");
    expect(skill.category).toBe("frontend");
    expect(skill.version).toBe("1.0.0");
    expect(skill.description.length).toBeGreaterThan(30);
  });

  it("has non-trivial activation metadata", async () => {
    const skill = await loader.loadBuiltinSkill("ui-review");
    expect(skill.activation?.when.length).toBeGreaterThan(0);
    expect(skill.activation?.notWhen?.length).toBeGreaterThan(0);
  });

  it("has non-trivial core instructions", async () => {
    const skill = await loader.loadBuiltinSkill("ui-review");
    expect(skill.instructions.length).toBeGreaterThan(2);
  });

  it("has a workflow", async () => {
    const skill = await loader.loadBuiltinSkill("ui-review");
    expect(skill.workflow?.length).toBeGreaterThan(0);
  });

  it("has anti-patterns (avoid section)", async () => {
    const skill = await loader.loadBuiltinSkill("ui-review");
    expect(skill.antiPatterns?.length).toBeGreaterThan(0);
  });

  it("has examples", async () => {
    const skill = await loader.loadBuiltinSkill("ui-review");
    expect(skill.examples?.length).toBeGreaterThan(0);
  });
});

describe("SkillLoader: discovers all four core SKILL.md packages", () => {
  const loader = new SkillLoader();

  it("discovers frontend-design, responsive-design, frontend-debugging, and ui-review from the built-in skills directory", async () => {
    const builtinDir = loader.getBuiltinSkillsDir();
    const skills = await loader.discoverSkills(builtinDir);
    const names = skills.map((s) => s.name).sort();

    expect(names).toContain("frontend-design");
    expect(names).toContain("responsive-design");
    expect(names).toContain("frontend-debugging");
    expect(names).toContain("ui-review");
  });
});

describe("Skill boundary validation: conceptual scenario coverage", () => {
  const loader = new SkillLoader();

  it("Scenario 1 — responsive-design covers layout-across-viewport tasks", async () => {
    const skill = await loader.loadBuiltinSkill("responsive-design");
    const activationText = (skill.activation?.when ?? []).join(" ").toLowerCase();
    expect(activationText).toMatch(/responsive|viewport|layout|widths/i);
  });

  it("Scenario 2 — frontend-debugging covers broken interaction diagnosis", async () => {
    const skill = await loader.loadBuiltinSkill("frontend-debugging");
    const activationText = (skill.activation?.when ?? []).join(" ").toLowerCase();
    expect(activationText).toMatch(/broken|debug|unexpected|error/i);
  });

  it("Scenario 3 — ui-review covers interface evaluation without modification", async () => {
    const skill = await loader.loadBuiltinSkill("ui-review");
    const activationText = (skill.activation?.when ?? []).join(" ").toLowerCase();
    expect(activationText).toMatch(/review|evaluate|audit|assess/i);
    // Must instruct not to auto-modify
    const allText = [
      ...skill.instructions,
      ...(skill.rules ?? []),
      ...(skill.antiPatterns ?? [])
    ].join(" ").toLowerCase();
    expect(allText).toMatch(/not.*edit|not.*modif|produce findings|do not edit/i);
  });

  it("Scenario 4 — frontend-design is appropriate for building new polished UI", async () => {
    const skill = await loader.loadBuiltinSkill("frontend-design");
    const activationText = (skill.activation?.when ?? []).join(" ").toLowerCase();
    expect(activationText).toMatch(/creating|build|component|page/i);
  });
});

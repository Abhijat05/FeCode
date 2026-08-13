import { describe, it, expect, beforeEach } from "vitest";
import { SkillLoader } from "./loader.js";

describe("Phase 4B.6B: Migrate & Upgrade Quality Skills", () => {
  let loader: SkillLoader;

  beforeEach(() => {
    loader = new SkillLoader();
  });

  const skillsToTest = [
    { name: "css", expectedCategory: "styling" },
    { name: "accessibility", expectedCategory: "accessibility" },
    { name: "frontend-performance", expectedCategory: "frontend" },
    { name: "frontend-testing", expectedCategory: "testing" }
  ];

  for (const { name, expectedCategory } of skillsToTest) {
    describe(`SKILL.md Package: ${name}`, () => {
      it("loads successfully via SkillLoader with rich sections", () => {
        const skill = loader.loadBuiltinSkillSync(name);

        expect(skill.name).toBe(name);
        expect(skill.category).toBe(expectedCategory);
        expect(skill.description).toBeDefined();
        expect(skill.description.length).toBeGreaterThan(10);
        expect(skill.version).toBeDefined();

        expect(skill.instructions).toBeDefined();
        expect(skill.instructions.length).toBeGreaterThan(0);
        
        const allText = [
          ...(skill.instructions || []),
          ...(skill.rules || []),
          ...(skill.workflow || []),
          ...(skill.antiPatterns || []),
        ].join("\n").toLowerCase();
        
        expect(allText).toContain("project");
        expect(allText).toContain("inspect");

        expect(skill.antiPatterns).toBeDefined();
        expect(skill.antiPatterns!.length).toBeGreaterThan(0);
        
        expect(skill.workflow).toBeDefined();
        expect(skill.workflow!.length).toBeGreaterThan(0);
        
        expect(skill.rules).toBeDefined();
        expect(skill.rules!.length).toBeGreaterThan(0);
      });
    });
  }
});

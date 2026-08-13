import { describe, it, expect, beforeEach } from "vitest";
import { SkillLoader } from "./loader.js";
import { DefaultSkillRegistry } from "./registry.js";
import { recommendSkillsFromRequest } from "./requestRecommender.js";
import type { ProjectContext } from "../project/types.js";

describe("Phase 4B.7: Skill Library Audit & Cleanup", () => {
  let loader: SkillLoader;
  let registry: DefaultSkillRegistry;

  const CANONICAL_SKILLS = [
    "frontend-design",
    "responsive-design",
    "ui-review",
    "react",
    "nextjs",
    "vue",
    "svelte",
    "css",
    "tailwind",
    "accessibility",
    "frontend-debugging",
    "frontend-performance",
    "frontend-testing"
  ];

  beforeEach(() => {
    loader = new SkillLoader();
    registry = new DefaultSkillRegistry();
    
    // Register all canonical skills
    for (const name of CANONICAL_SKILLS) {
      registry.register(loader.loadBuiltinSkillSync(name));
    }
  });

  describe("Canonical Skill Loading", () => {
    it("verifies all 13 canonical SKILL.md skills exist and load properly", () => {
      const skills = registry.list();
      expect(skills.length).toBe(13);

      const loadedNames = skills.map((s: { name: string }) => s.name);
      for (const name of CANONICAL_SKILLS) {
        expect(loadedNames).toContain(name);
      }

      for (const skill of skills) {
        expect(skill.name).toBeTruthy();
        expect(skill.description).toBeTruthy();
        expect(skill.category).toBeTruthy();
        expect(skill.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(skill.instructions).toBeDefined();
        expect(skill.instructions.length).toBeGreaterThan(0);
      }
    });

    it("verifies no duplicate canonical skill names exist in the registry", () => {
      const skills = registry.list();
      const names = new Set(skills.map((s: { name: string }) => s.name));
      expect(names.size).toBe(skills.length);
    });
  });

  describe("Deterministic Skill Recommender Scenarios", () => {
    const mockContext = (deps: string[]): ProjectContext => ({
      projectRoot: "/fake/root",
      languages: ["typescript"],
      framework: deps.includes("react") ? "react" : deps.includes("vue") ? "vue" : deps.includes("svelte") ? "svelte" : deps.includes("next") ? "next" : null,
      frameworkVersion: null,
      buildTool: null,
      styling: deps.includes("tailwindcss") ? ["tailwind"] : [],
      testing: deps.includes("jest") ? ["jest"] : [],
      packageManager: "npm",
      sourceDirectories: [],
      componentDirectories: [],
      configFiles: []
    });

    it("Scenario A: Build a polished React dashboard", () => {
      const recs = recommendSkillsFromRequest({
        request: "Build a polished React dashboard.",
        registry,
        projectContext: mockContext(["react"])
      });
      const names = recs.map((s: { skill: { name: string } }) => s.skill.name);
      expect(names).toContain("react");
      expect(names).toContain("frontend-design");
      expect(names).not.toContain("vue");
      expect(names.length).toBeLessThanOrEqual(5);
    });

    it("Scenario B: Make this dashboard responsive", () => {
      const recs = recommendSkillsFromRequest({
        request: "Make this dashboard responsive",
        registry,
        projectContext: mockContext(["react"])
      });
      const names = recs.map((s: { skill: { name: string } }) => s.skill.name);
      expect(names).toContain("responsive-design");
      expect(names.length).toBeLessThanOrEqual(5);
    });

    it("Scenario C: The React page breaks on mobile", () => {
      const recs = recommendSkillsFromRequest({
        request: "The React page breaks on mobile",
        registry,
        projectContext: mockContext(["react"])
      });
      const names = recs.map((s: { skill: { name: string } }) => s.skill.name);
      expect(names).toContain("frontend-debugging");
      expect(names).toContain("responsive-design");
      expect(names).toContain("react");
    });

    it("Scenario D: Review this dashboard", () => {
      const recs = recommendSkillsFromRequest({
        request: "Review this dashboard.",
        registry,
        projectContext: mockContext([])
      });
      const names = recs.map((s: { skill: { name: string } }) => s.skill.name);
      expect(names).toContain("ui-review");
    });

    it("Scenario E: Fix the Tailwind spacing", () => {
      const recs = recommendSkillsFromRequest({
        request: "Fix the Tailwind spacing",
        registry,
        projectContext: mockContext(["tailwindcss"])
      });
      const names = recs.map((s: { skill: { name: string } }) => s.skill.name);
      expect(names).toContain("tailwind");
    });

    it("Scenario F: Make this modal accessible", () => {
      const recs = recommendSkillsFromRequest({
        request: "Make this modal accessible",
        registry,
        projectContext: mockContext([])
      });
      const names = recs.map((s: { skill: { name: string } }) => s.skill.name);
      expect(names).toContain("accessibility");
    });

    it("Scenario G: Why is this page slow?", () => {
      const recs = recommendSkillsFromRequest({
        request: "Why is this page slow?",
        registry,
        projectContext: mockContext([])
      });
      const names = recs.map((s: { skill: { name: string } }) => s.skill.name);
      expect(names).toContain("frontend-performance");
    });

    it("Scenario H: Add tests for this form", () => {
      const recs = recommendSkillsFromRequest({
        request: "Add tests for this form",
        registry,
        projectContext: mockContext([])
      });
      const names = recs.map((s: { skill: { name: string } }) => s.skill.name);
      expect(names).toContain("frontend-testing");
    });

    it("Scenario I: False Positive - Fix the API authentication middleware", () => {
      const recs = recommendSkillsFromRequest({
        request: "Fix the API authentication middleware",
        registry,
        projectContext: mockContext([])
      });
      const names = recs.map((s: { skill: { name: string } }) => s.skill.name);
      expect(names).not.toContain("frontend-design");
      expect(names).not.toContain("react");
    });
    
    it("Scenario J: False Positive - Create a PostgreSQL index", () => {
      const recs = recommendSkillsFromRequest({
        request: "Create a PostgreSQL index",
        registry,
        projectContext: mockContext([])
      });
      const names = recs.map((s: { skill: { name: string } }) => s.skill.name);
      expect(names.length).toBe(0);
    });
  });
});

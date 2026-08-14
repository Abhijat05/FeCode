import { describe, it, expect, beforeEach } from "vitest";
import { SkillLoader } from "./loader.js";
import { DefaultSkillRegistry } from "./registry.js";
import { recommendSkillsFromRequest } from "./requestRecommender.js";
import type { ProjectContext } from "../project/types.js";

const reactCtx: ProjectContext = {
  projectRoot: "/test",
  projectType: "frontend",
  languages: ["typescript"],
  framework: "react",
  frameworks: ["react"],
  frameworkVersion: "18.3.1",
  buildTool: "vite",
  styling: [],
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

const nextCtx: ProjectContext = {
  ...reactCtx,
  framework: "next",
  frameworkVersion: "14.2.0",
  buildTool: "next"
};

const vueCtx: ProjectContext = {
  ...reactCtx,
  framework: "vue"
};

const svelteCtx: ProjectContext = {
  ...reactCtx,
  framework: "svelte"
};

const tailwindCtx: ProjectContext = {
  ...reactCtx,
  styling: ["tailwind"]
};

const noCtx = undefined;

describe("Phase 4B.6A: Framework & Styling Skills", () => {
  let loader: SkillLoader;
  let registry: DefaultSkillRegistry;

  beforeEach(async () => {
    loader = new SkillLoader();
    registry = new DefaultSkillRegistry();
    const skills = await loader.discoverSkills(loader.getBuiltinSkillsDir());
    for (const skill of skills) {
      registry.register(skill);
    }
  });

  const frameworks = ["react", "nextjs", "vue", "svelte", "tailwind"];

  for (const name of frameworks) {
    describe(`SKILL.md Package: ${name}`, () => {
      it("loads successfully via SkillLoader with rich sections", async () => {
        const skill = await loader.loadBuiltinSkill(name);
        expect(skill).toBeDefined();
        expect(skill.name).toBe(name);
        expect(skill.category).toMatch(/framework|styling/);
        expect(skill.description).toBeDefined();
        expect(skill.version).toBeDefined();
        expect(skill.instructions?.length).toBeGreaterThan(0);
        
        // Assert lightweight content quality (headings we expect the parser to have placed in rules/instructions/antiPatterns/workflow)
        // Since we parse SKILL.md into instructions/rules/antiPatterns/workflow arrays, we should check that
        // the parsed sections actually received the rich content.
        
        // The SKILL.md format puts "Anti-Patterns", "Avoid", etc. into antiPatterns
        // The new skills should have antiPatterns.
        expect(skill.antiPatterns?.length ?? 0).toBeGreaterThan(0);

        // All new skills should contain "Project Detection" or similar wording in their instructions or rules.
        const allText = [
          ...(skill.instructions ?? []),
          ...(skill.rules ?? []),
          ...(skill.workflow ?? []),
          ...(skill.antiPatterns ?? [])
        ].join("\n").toLowerCase();
        
        expect(allText).toContain("project");
        expect(allText).toContain("inspect");
      });

      it("has activation metadata", async () => {
        const skill = await loader.loadBuiltinSkill(name);
        expect(skill.activation?.when).toBeDefined();
        expect(skill.activation?.when?.length).toBeGreaterThan(0);
      });
    });
  }

  describe("Recommendation integration", () => {
    it("recommends react for React context", () => {
      const results = recommendSkillsFromRequest({
        request: "Fix this component",
        registry,
        projectContext: reactCtx,
        maxResults: 10
      });
      const names = results.map(r => r.skill.name);
      expect(names).toContain("react");
    });

    it("recommends nextjs for Next.js context", () => {
      const results = recommendSkillsFromRequest({
        request: "Fix this page",
        registry,
        projectContext: nextCtx,
        maxResults: 10
      });
      const names = results.map(r => r.skill.name);
      expect(names).toContain("nextjs");
    });

    it("recommends vue for Vue context", () => {
      const results = recommendSkillsFromRequest({
        request: "Create a component",
        registry,
        projectContext: vueCtx,
        maxResults: 10
      });
      const names = results.map(r => r.skill.name);
      expect(names).toContain("vue");
    });

    it("recommends svelte for Svelte context", () => {
      const results = recommendSkillsFromRequest({
        request: "Fix this component",
        registry,
        projectContext: svelteCtx,
        maxResults: 10
      });
      const names = results.map(r => r.skill.name);
      expect(names).toContain("svelte");
    });

    it("recommends tailwind for Tailwind context", () => {
      const results = recommendSkillsFromRequest({
        request: "Update the tailwind styling of this button",
        registry,
        projectContext: tailwindCtx,
        maxResults: 10
      });
      const names = results.map(r => r.skill.name);
      expect(names).toContain("tailwind");
    });

    it("does not recommend tailwind without context or explicit request", () => {
      const results = recommendSkillsFromRequest({
        request: "Update the logic of this module",
        registry,
        projectContext: noCtx,
        maxResults: 10
      });
      const names = results.map(r => r.skill.name);
      expect(names).not.toContain("tailwind");
    });
  });
});

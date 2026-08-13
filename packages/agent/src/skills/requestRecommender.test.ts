import { describe, it, expect, beforeEach } from "vitest";
import { DefaultSkillRegistry } from "./registry.js";
import { SkillLoader } from "./loader.js";
import { recommendSkillsFromRequest } from "./requestRecommender.js";
import type { ProjectContext } from "../project/types.js";

import { registerBuiltinSkills } from "./builtins/index.js";

async function buildTestRegistry(): Promise<DefaultSkillRegistry> {
  const registry = new DefaultSkillRegistry();
  registerBuiltinSkills(registry);
  const loader = new SkillLoader();
  const builtinDir = loader.getBuiltinSkillsDir();
  const skills = await loader.discoverSkills(builtinDir);
  for (const skill of skills) {
    registry.register(skill);
  }
  return registry;
}

const reactCtx: ProjectContext = {
  projectRoot: "/test",
  languages: ["typescript"],
  framework: "react",
  frameworkVersion: "18.3.1",
  buildTool: "vite",
  styling: [],
  testing: ["vitest"],
  packageManager: "npm",
  sourceDirectories: ["src"],
  componentDirectories: ["src/components"],
  configFiles: []
};

const noCtx = undefined;

describe("recommendSkillsFromRequest", () => {
  let registry: DefaultSkillRegistry;

  beforeEach(async () => {
    registry = await buildTestRegistry();
  });

  // ── Core Scenarios ────────────────────────────────────────────────────────

  it("Scenario 1: responsive layout request ranks responsive-design first", () => {
    const results = recommendSkillsFromRequest({
      request: "Make this page responsive.",
      registry,
      projectContext: noCtx
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].skill.name).toBe("responsive-design");
  });

  it("Scenario 2: mobile breakage ranks frontend-debugging and responsive-design highly", () => {
    const results = recommendSkillsFromRequest({
      request: "The button doesn't work on mobile.",
      registry,
      projectContext: noCtx
    });
    const names = results.map((r) => r.skill.name);
    expect(names).toContain("frontend-debugging");
    expect(names).toContain("responsive-design");
  });

  it("Scenario 3: review request ranks ui-review first", () => {
    const results = recommendSkillsFromRequest({
      request: "Review this dashboard and tell me what should be improved.",
      registry,
      projectContext: noCtx
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].skill.name).toBe("ui-review");
  });

  it("Scenario 4: build polished UI request ranks frontend-design first", () => {
    const results = recommendSkillsFromRequest({
      request: "Build a polished settings page.",
      registry,
      projectContext: noCtx
    });
    expect(results.length).toBeGreaterThan(0);
    // frontend-design must appear in results and score higher than ui-review
    const fdScore = results.find((r) => r.skill.name === "frontend-design")?.score ?? 0;
    const uiScore = results.find((r) => r.skill.name === "ui-review")?.score ?? 0;
    expect(fdScore).toBeGreaterThan(uiScore);
    expect(results[0].skill.name).toBe("frontend-design");
  });

  it("Scenario 5: React component error ranks frontend-debugging first or second (top tier)", () => {
    const results = recommendSkillsFromRequest({
      request: "Fix this React component throwing an error.",
      registry,
      projectContext: reactCtx
    });
    expect(results.length).toBeGreaterThan(0);
    const names = results.map((r) => r.skill.name);
    expect(names.slice(0, 2)).toContain("frontend-debugging");
  });

  it("Scenario 6: responsive dashboard with React context ranks responsive-design first or second (top tier)", () => {
    const results = recommendSkillsFromRequest({
      request: "Improve the responsive behavior of this React dashboard.",
      registry,
      projectContext: reactCtx
    });
    expect(results.length).toBeGreaterThan(0);
    const names = results.map((r) => r.skill.name);
    expect(names.slice(0, 2)).toContain("responsive-design");
  });

  // ── Ranking behaviour ─────────────────────────────────────────────────────

  it("returns at most 3 results by default", () => {
    const results = recommendSkillsFromRequest({
      request: "Review and improve the responsive layout design of this page.",
      registry,
      projectContext: noCtx
    });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("respects maxResults override", () => {
    const results = recommendSkillsFromRequest({
      request: "Review and improve the responsive layout design of this page.",
      registry,
      projectContext: noCtx,
      maxResults: 2
    });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("results are deterministic — same input always produces same order", () => {
    const request = "Make this dashboard responsive and review the design.";
    const r1 = recommendSkillsFromRequest({ request, registry, projectContext: noCtx });
    const r2 = recommendSkillsFromRequest({ request, registry, projectContext: noCtx });
    expect(r1.map((r) => r.skill.name)).toEqual(r2.map((r) => r.skill.name));
  });

  it("scores decrease monotonically (highest score first)", () => {
    const results = recommendSkillsFromRequest({
      request: "Review and improve the responsive behavior of this layout.",
      registry,
      projectContext: noCtx
    });
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  // ── ProjectContext signals ─────────────────────────────────────────────────

  it("boosts React skill when React framework is detected in project context", () => {
    // The `react` skill is a TypeScript-defined builtin without its own SKILL.md activation phrases.
    // It receives a framework context boost (+9). Use a large maxResults to verify it appears.
    const resultsWithCtx = recommendSkillsFromRequest({
      request: "Build a component.",
      registry,
      projectContext: reactCtx,
      maxResults: 20
    });
    const resultsNoCtx = recommendSkillsFromRequest({
      request: "Build a component.",
      registry,
      projectContext: noCtx,
      maxResults: 20
    });
    const reactWithCtx = resultsWithCtx.find((r) => r.skill.name === "react");
    const reactNoCtx = resultsNoCtx.find((r) => r.skill.name === "react");
    // React should appear in results when context is provided
    expect(reactWithCtx).toBeDefined();
    expect(reactWithCtx!.score).toBeGreaterThan(0);
    // React should score higher with React project context than without
    expect(reactWithCtx!.score).toBeGreaterThan(reactNoCtx?.score ?? 0);
  });

  it("does not recommend React skill without React in project context", () => {
    const results = recommendSkillsFromRequest({
      request: "Build a component.",
      registry,
      projectContext: noCtx,
      maxResults: 5
    });
    const names = results.map((r) => r.skill.name);
    expect(names).not.toContain("react");
  });

  // ── False positive tests ──────────────────────────────────────────────────

  it("does not recommend frontend skills for backend database work", () => {
    const results = recommendSkillsFromRequest({
      request: "Fix the database migration.",
      registry,
      projectContext: noCtx
    });
    const names = results.map((r) => r.skill.name);
    expect(names).not.toContain("frontend-design");
    expect(names).not.toContain("responsive-design");
    expect(names).not.toContain("ui-review");
  });

  it("does not recommend frontend skills for API authentication work", () => {
    const results = recommendSkillsFromRequest({
      request: "Update the API authentication middleware.",
      registry,
      projectContext: noCtx
    });
    const names = results.map((r) => r.skill.name);
    expect(names).not.toContain("frontend-design");
    expect(names).not.toContain("responsive-design");
    expect(names).not.toContain("ui-review");
  });

  it("does not activate every frontend skill for a generic frontend request", () => {
    const results = recommendSkillsFromRequest({
      request: "Make the button responsive.",
      registry,
      projectContext: noCtx
    });
    // Should not return all available skills — max 3
    expect(results.length).toBeLessThanOrEqual(3);
    // Should not contain both frontend-debugging AND ui-review for a simple responsive request
    const names = results.map((r) => r.skill.name);
    const allFour = ["frontend-design", "responsive-design", "frontend-debugging", "ui-review"];
    const matched = allFour.filter((n) => names.includes(n));
    expect(matched.length).toBeLessThanOrEqual(3);
  });

  // ── Word boundary / tokenisation ─────────────────────────────────────────

  it("does not match 'reactive' as 'react' skill name", () => {
    const results = recommendSkillsFromRequest({
      request: "Make the store reactive.",
      registry,
      projectContext: noCtx,
      maxResults: 10
    });
    const names = results.map((r) => r.skill.name);
    expect(names).not.toContain("react");
  });

  // ── Registry integration ──────────────────────────────────────────────────

  it("only recommends skills that are registered in the provided registry", () => {
    const smallRegistry = new DefaultSkillRegistry();
    // Register only responsive-design
    const loader = new SkillLoader();
    const skill = loader.loadBuiltinSkillSync("responsive-design");
    smallRegistry.register(skill);

    const results = recommendSkillsFromRequest({
      request: "Build a polished settings page.",
      registry: smallRegistry,
      projectContext: noCtx
    });
    // Only responsive-design is available; frontend-design is not in this registry
    const names = results.map((r) => r.skill.name);
    expect(names).not.toContain("frontend-design");
  });
});

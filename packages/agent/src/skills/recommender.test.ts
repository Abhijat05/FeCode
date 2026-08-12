import { describe, it, expect } from "vitest";
import { recommendSkills } from "./recommender.js";
import type { ProjectContext } from "../project/types.js";

describe("recommendSkills", () => {
  it("recommends appropriate skills for React + TypeScript + Tailwind project", () => {
    const ctx: ProjectContext = {
      projectRoot: "/test",
      languages: ["typescript"],
      framework: "react",
      frameworkVersion: "18.3.1",
      buildTool: "vite",
      styling: ["tailwind"],
      testing: ["vitest"],
      packageManager: "npm",
      sourceDirectories: ["src"],
      componentDirectories: ["src/components"],
      configFiles: []
    };

    const recs = recommendSkills(ctx);
    expect(recs).toEqual([
      "frontend-design",
      "frontend-debugging",
      "accessibility",
      "typescript-frontend",
      "testing-frontend",
      "react",
      "tailwind"
    ]);
  });

  it("recommends appropriate skills for Next.js project", () => {
    const ctx: ProjectContext = {
      projectRoot: "/test",
      languages: ["typescript"],
      framework: "next",
      frameworkVersion: "14.2.0",
      buildTool: "next",
      styling: [],
      testing: [],
      packageManager: "pnpm",
      sourceDirectories: ["app"],
      componentDirectories: ["components"],
      configFiles: []
    };

    const recs = recommendSkills(ctx);
    expect(recs).toEqual([
      "frontend-design",
      "frontend-debugging",
      "accessibility",
      "typescript-frontend",
      "react",
      "nextjs"
    ]);
  });

  it("recommends appropriate skills for Vue project", () => {
    const ctx: ProjectContext = {
      projectRoot: "/test",
      languages: ["javascript"],
      framework: "vue",
      frameworkVersion: "3.4.0",
      buildTool: "vite",
      styling: [],
      testing: [],
      packageManager: "yarn",
      sourceDirectories: ["src"],
      componentDirectories: ["src/components"],
      configFiles: []
    };

    const recs = recommendSkills(ctx);
    expect(recs).toEqual([
      "frontend-design",
      "frontend-debugging",
      "accessibility",
      "vue"
    ]);
  });

  it("recommends default base skills for unknown or empty project", () => {
    const recsEmpty = recommendSkills(undefined);
    expect(recsEmpty).toEqual([
      "frontend-design",
      "frontend-debugging",
      "accessibility"
    ]);
  });
});

import { describe, it, expect } from "vitest";
import { recommendSkills } from "./recommender.js";
import type { ProjectContext } from "../project/types.js";

describe("recommendSkills", () => {
  it("recommends appropriate skills for React + TypeScript + Tailwind project", () => {
    const reactCtx: ProjectContext = {
      projectRoot: "/test",
      projectType: "frontend",
      languages: ["typescript"],
      framework: "react",
      frameworks: ["react"],
      frameworkVersion: "18.3.1",
      buildTool: "vite",
      styling: ["tailwind"],
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

    const recs = recommendSkills(reactCtx);
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
    const nextCtx: ProjectContext = {
      projectRoot: "/test",
      projectType: "fullstack",
      languages: ["typescript"],
      framework: "next",
      frameworks: ["react", "nextjs"],
      frameworkVersion: "14.2.0",
      buildTool: "next",
      styling: [],
      testing: [],
      packageManager: "pnpm",
      structure: {
        sourceDirectories: ["app"],
        componentDirectories: ["components"],
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

    const recs = recommendSkills(nextCtx);
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
    const vueCtx: ProjectContext = {
      projectRoot: "/test",
      projectType: "frontend",
      languages: ["javascript"],
      framework: "vue",
      frameworks: ["vue"],
      frameworkVersion: "3.4.0",
      buildTool: "vite",
      styling: [],
      testing: [],
      packageManager: "yarn",
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

    const recs = recommendSkills(vueCtx);
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

import { describe, it, expect, beforeEach } from "vitest";
import { SkillActivationPolicy } from "./activation.js";
import { DefaultSkillRegistry } from "./registry.js";
import type { Skill } from "./types.js";
import type { ProjectContext } from "../project/types.js";

const mockReactSkill: Skill = {
  name: "react",
  version: "1.0.0",
  description: "React implementation guidelines",
  category: "framework",
  instructions: ["Use hooks", "Do not mutate state"],
  activation: {
    when: ["react", "component", "jsx"],
    notWhen: ["backend", "api"]
  }
};

const mockTailwindSkill: Skill = {
  name: "tailwind",
  version: "1.0.0",
  description: "Tailwind styling",
  category: "styling",
  instructions: ["Use utility classes"],
  activation: {
    when: ["tailwind", "css", "styling", "spacing"]
  }
};

const mockDesignSkill: Skill = {
  name: "frontend-design",
  version: "1.0.0",
  description: "Design UI",
  category: "frontend",
  instructions: ["Make it beautiful"],
  activation: {
    when: ["design", "layout", "polished"],
    notWhen: ["backend"]
  }
};

const mockDebuggingSkill: Skill = {
  name: "frontend-debugging",
  version: "1.0.0",
  description: "Debugging",
  category: "frontend",
  instructions: ["Find bugs"],
  activation: {
    when: ["fix", "broken", "bug", "error"]
  }
};

describe("SkillActivationPolicy", () => {
  let registry: DefaultSkillRegistry;
  let policy: SkillActivationPolicy;

  const reactCtx: ProjectContext = {
    projectRoot: "/test",
    projectType: "frontend",
    languages: ["typescript"],
    framework: "react",
    frameworks: ["react"],
    frameworkVersion: "18.0.0",
    buildTool: "vite",
    styling: ["tailwind"],
    testing: [],
    packageManager: "npm",
    structure: {
      sourceDirectories: ["src"],
      componentDirectories: ["src/components"],
      routeDirectories: [],
      testDirectories: [],
      assetDirectories: []
    },
    scripts: {},
    configuration: { framework: [], styling: [], build: [], testing: [] }
  };

  const nextCtx: ProjectContext = {
    ...reactCtx,
    projectType: "fullstack",
    framework: "next",
    frameworks: ["react", "nextjs"]
  };

  beforeEach(() => {
    registry = new DefaultSkillRegistry();
    registry.register(mockReactSkill);
    registry.register(mockTailwindSkill);
    registry.register(mockDesignSkill);
    registry.register(mockDebuggingSkill);

    policy = new SkillActivationPolicy({ maxSkills: 3, minThreshold: 5.0 });
  });

  it("activates framework skill based on task relevance + project context", () => {
    const result = policy.activate("Refactor this component", registry, reactCtx);
    expect(result.skills.map(s => s.name)).toContain("react");
    // Tailwind shouldn't activate just because it's in the project unless requested
    expect(result.skills.map(s => s.name)).not.toContain("tailwind");
  });

  it("activates styling skill when requested in matching project context", () => {
    const result = policy.activate("Fix the spacing on this button", registry, reactCtx);
    expect(result.skills.map(s => s.name)).toContain("tailwind");
  });

  it("does not activate framework skill for unrelated tasks", () => {
    const result = policy.activate("Fix the authentication API", registry, reactCtx);
    // Even though project is React, the task is backend/API related
    expect(result.skills.map(s => s.name)).not.toContain("react");
  });

  it("activates design skill based on intent", () => {
    const result = policy.activate("Create a polished landing page", registry, reactCtx);
    expect(result.skills.map(s => s.name)).toContain("frontend-design");
  });

  it("activates debugging skill based on intent", () => {
    const result = policy.activate("The button throws an error", registry, reactCtx);
    expect(result.skills.map(s => s.name)).toContain("frontend-debugging");
  });

  it("limits maximum skills activated", () => {
    // "design" -> frontend-design
    // "react" -> react
    // "tailwind" -> tailwind
    // "bug" -> frontend-debugging
    // 4 matches, but limit is 3
    const result = policy.activate("Design a polished react component with tailwind and fix the bug", registry, reactCtx);
    expect(result.skills.length).toBeLessThanOrEqual(3);
  });

  it("filters out weak matches below threshold", () => {
    const result = policy.activate("Something completely unrelated", registry, reactCtx);
    expect(result.skills.length).toBe(0);
  });

  it("respects backend penalty preventing frontend skills", () => {
    const result = policy.activate("Fix the authentication middleware database", registry, nextCtx);
    // NextCtx is fullstack, but request has strong backend keywords ("middleware", "database")
    // Should penalize design
    expect(result.skills.map(s => s.name)).not.toContain("frontend-design");
  });

  it("activation is deterministic", () => {
    const result1 = policy.activate("Build a react component using tailwind", registry, reactCtx);
    const result2 = policy.activate("Build a react component using tailwind", registry, reactCtx);
    
    expect(result1.skills.map(s => s.name)).toEqual(result2.skills.map(s => s.name));
  });
});

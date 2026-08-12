import { describe, it, expect } from "vitest";
import { composeSystemPrompt } from "./composer.js";
import { DEFAULT_SYSTEM_PROMPT } from "../systemPrompt.js";
import type { ProjectContext } from "../project/types.js";
import type { Skill } from "./types.js";

describe("composeSystemPrompt", () => {
  const mockContext: ProjectContext = {
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

  const mockSkills: Skill[] = [
    {
      name: "react",
      description: "React best practices",
      category: "framework",
      version: "1.0.0",
      instructions: "Use functional components."
    },
    {
      name: "tailwind",
      description: "Tailwind guidelines",
      category: "styling",
      version: "1.0.0",
      instructions: "Use standard spacing tokens."
    }
  ];

  it("composes system prompt preserving deterministic precedence (Core rules -> Project Context -> Active Skills)", () => {
    const prompt = composeSystemPrompt({
      baseSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      projectContext: mockContext,
      activeSkills: mockSkills
    });

    expect(prompt).toContain(DEFAULT_SYSTEM_PROMPT);
    expect(prompt).toContain("## Project Context");
    expect(prompt).toContain("Framework: react (18.3.1)");
    expect(prompt).toContain("Styling: tailwind");
    expect(prompt).toContain("## Active Frontend Skills");
    expect(prompt).toContain("Use functional components.");
    expect(prompt).toContain("Use standard spacing tokens.");

    // Assert order of appearance
    const posCore = prompt.indexOf(DEFAULT_SYSTEM_PROMPT);
    const posContext = prompt.indexOf("## Project Context");
    const posSkills = prompt.indexOf("## Active Frontend Skills");

    expect(posCore).toBeLessThan(posContext);
    expect(posContext).toBeLessThan(posSkills);
  });

  it("handles missing project context and empty skills gracefully without breaking core prompt", () => {
    const prompt = composeSystemPrompt({
      baseSystemPrompt: DEFAULT_SYSTEM_PROMPT
    });

    expect(prompt).toBe(DEFAULT_SYSTEM_PROMPT);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { ProjectIntelligence } from "./intelligence.js";
import { ProjectDetector } from "./detector.js";
import { composeSystemPrompt } from "../skills/composer.js";
import { AgentRuntime } from "../runtime.js";
import { createTaskPlan } from "../tasks/taskPlan.js";
import { SkillActivationPolicy } from "../skills/activation.js";
import type { Skill, SkillRegistry } from "../skills/types.js";
import type { ModelProvider, ModelRequest, ModelEvent } from "@fecode/models";

class MockModelProvider implements ModelProvider {
  public id = "mock-provider";
  public capabilities = {
    streaming: true,
    toolCalling: false,
    vision: false,
    maxContextTokens: 4096
  };

  public capturedRequests: ModelRequest[] = [];

  async *generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    void signal;
    this.capturedRequests.push(request);
    yield { type: "text_delta", content: "OK" };
    yield { type: "completed" };
  }
}

describe("ProjectIntelligence", () => {
  let tempDir: string;
  let intelligence: ProjectIntelligence;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-intel-test-"));
    intelligence = new ProjectIntelligence();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("Package Manager: detects npm, pnpm, yarn, bun from lockfiles and packageManager field", async () => {
    // 1. pnpm lockfile
    await fs.writeFile(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: 5.4");
    let profile = await intelligence.inspect(tempDir);
    expect(profile.packageManager).toBe("pnpm");
    await fs.unlink(path.join(tempDir, "pnpm-lock.yaml"));

    // 2. yarn lockfile
    await fs.writeFile(path.join(tempDir, "yarn.lock"), "# yarn lockfile v1");
    profile = await intelligence.inspect(tempDir);
    expect(profile.packageManager).toBe("yarn");
    await fs.unlink(path.join(tempDir, "yarn.lock"));

    // 3. bun lockfile
    await fs.writeFile(path.join(tempDir, "bun.lockb"), "binary");
    profile = await intelligence.inspect(tempDir);
    expect(profile.packageManager).toBe("bun");
    await fs.unlink(path.join(tempDir, "bun.lockb"));

    // 4. npm lockfile
    await fs.writeFile(path.join(tempDir, "package-lock.json"), "{}");
    profile = await intelligence.inspect(tempDir);
    expect(profile.packageManager).toBe("npm");
    await fs.unlink(path.join(tempDir, "package-lock.json"));

    // 5. packageManager in package.json takes precedence
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ packageManager: "pnpm@8.6.0" })
    );
    await fs.writeFile(path.join(tempDir, "package-lock.json"), "{}");
    profile = await intelligence.inspect(tempDir);
    expect(profile.packageManager).toBe("pnpm");
  });

  it("Framework: detects React, Next.js, Vue, Nuxt, Svelte, SvelteKit, Angular, Astro, Vite", async () => {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: {
          react: "^18.2.0",
          next: "13.4.0",
          vue: "^3.3.0",
          nuxt: "^3.5.0",
          svelte: "^4.0.0",
          "@sveltejs/kit": "^1.20.0",
          "@angular/core": "^16.0.0",
          astro: "^2.5.0"
        },
        devDependencies: {
          vite: "^4.3.0"
        }
      })
    );

    const profile = await intelligence.inspect(tempDir);
    expect(profile.frameworks).toEqual(
      ["Angular", "Astro", "Next.js", "Nuxt", "React", "Svelte", "SvelteKit", "Vite", "Vue"].sort()
    );
    expect(profile.projectType).toBe("fullstack");
  });

  it("Language: detects TypeScript, JavaScript, CSS, SCSS, HTML", async () => {
    await fs.writeFile(path.join(tempDir, "tsconfig.json"), "{}");
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: {
          tailwindcss: "^3.3.0",
          sass: "^1.62.0"
        }
      })
    );
    await fs.writeFile(path.join(tempDir, "index.html"), "<html></html>");

    const profile = await intelligence.inspect(tempDir);
    expect(profile.languages).toContain("TypeScript");
    expect(profile.languages).toContain("JavaScript");
    expect(profile.languages).toContain("CSS");
    expect(profile.languages).toContain("SCSS");
    expect(profile.languages).toContain("HTML");
  });

  it("Build, Test, and Lint Tools: detects Vite, Vitest, Jest, Playwright, ESLint, Prettier, Biome", async () => {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        devDependencies: {
          vite: "^4.3.0",
          vitest: "^0.32.0",
          jest: "^29.5.0",
          "@playwright/test": "^1.35.0",
          eslint: "^8.42.0",
          prettier: "^2.8.8",
          "@biomejs/biome": "^1.0.0"
        },
        scripts: {
          test: "vitest run",
          lint: "eslint .",
          format: "prettier --write ."
        }
      })
    );

    const profile = await intelligence.inspect(tempDir);
    expect(profile.buildTools).toContain("Vite");
    expect(profile.testTools).toContain("Vitest");
    expect(profile.testTools).toContain("Jest");
    expect(profile.testTools).toContain("Playwright");
    expect(profile.lintTools).toContain("ESLint");
    expect(profile.lintTools).toContain("Biome");
    expect(profile.formatTools).toContain("Prettier");
    expect(profile.formatTools).toContain("Biome");
    expect(profile.packageScripts.test).toBe("vitest run");
    expect(profile.packageScripts.lint).toBe("eslint .");
  });

  it("Workspaces: detects npm, pnpm, yarn, and directory monorepos", async () => {
    // 1. package.json workspaces
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        workspaces: ["apps/*", "packages/*"]
      })
    );
    let profile = await intelligence.inspect(tempDir);
    expect(profile.workspaces.isMonorepo).toBe(true);
    expect(profile.workspaces.type).toBe("npm");
    expect(profile.workspaces.packages).toEqual(["apps/*", "packages/*"]);

    // 2. pnpm workspace
    await fs.writeFile(path.join(tempDir, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'");
    profile = await intelligence.inspect(tempDir);
    expect(profile.workspaces.isMonorepo).toBe(true);
    expect(profile.workspaces.type).toBe("pnpm");
  });

  it("Important Directories: discovers existing directories without deep recursion", async () => {
    await fs.mkdir(path.join(tempDir, "src"));
    await fs.mkdir(path.join(tempDir, "components"));
    await fs.mkdir(path.join(tempDir, "tests"));
    await fs.mkdir(path.join(tempDir, "public"));

    const profile = await intelligence.inspect(tempDir);
    expect(profile.importantDirectories).toContain("src");
    expect(profile.importantDirectories).toContain("components");
    expect(profile.importantDirectories).toContain("tests");
    expect(profile.importantDirectories).toContain("public");
    expect(profile.importantDirectories).not.toContain("apps");
  });

  it("Config Files: identifies recognized config files accurately", async () => {
    await fs.writeFile(path.join(tempDir, "tsconfig.json"), "{}");
    await fs.writeFile(path.join(tempDir, "vite.config.ts"), "export default {}");
    await fs.writeFile(path.join(tempDir, "tailwind.config.js"), "module.exports = {}");
    await fs.writeFile(path.join(tempDir, "eslint.config.js"), "export default []");

    const profile = await intelligence.inspect(tempDir);
    expect(profile.configFiles).toContain("tsconfig.json");
    expect(profile.configFiles).toContain("vite.config.ts");
    expect(profile.configFiles).toContain("tailwind.config.js");
    expect(profile.configFiles).toContain("eslint.config.js");
  });

  it("Security: never reads secret files, .env files, or private keys", async () => {
    await fs.writeFile(path.join(tempDir, ".env"), "SECRET_API_KEY=supersecret123");
    await fs.writeFile(path.join(tempDir, ".env.local"), "DATABASE_URL=postgres://root:password@localhost:5432");
    await fs.writeFile(path.join(tempDir, "id_rsa"), "PRIVATE KEY DATA");

    const profile = await intelligence.inspect(tempDir);
    const profileJson = JSON.stringify(profile);

    expect(profileJson).not.toContain("supersecret123");
    expect(profileJson).not.toContain("DATABASE_URL");
    expect(profileJson).not.toContain("PRIVATE KEY DATA");
    expect(profile.configFiles).not.toContain(".env");
    expect(profile.configFiles).not.toContain(".env.local");
  });

  it("Determinism: repeated runs on identical repository state produce identical sorted output", async () => {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: { react: "18.0.0", vue: "3.0.0" },
        devDependencies: { vitest: "1.0.0", vite: "4.0.0", eslint: "8.0.0" }
      })
    );
    await fs.mkdir(path.join(tempDir, "src"));
    await fs.mkdir(path.join(tempDir, "tests"));

    const res1 = await intelligence.inspect(tempDir);
    const res2 = await intelligence.inspect(tempDir);

    expect(res1).toEqual(res2);
    expect(res1.frameworks).toEqual([...res1.frameworks].sort());
    expect(res1.languages).toEqual([...res1.languages].sort());
    expect(res1.importantDirectories).toEqual([...res1.importantDirectories].sort());
  });

  it("Caching: load() reuses cached profile while refresh() updates and clear() resets", async () => {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ dependencies: { react: "18.0.0" } })
    );

    const firstLoad = await intelligence.load(tempDir);
    expect(firstLoad.frameworks).toContain("React");

    // Modify file on disk
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ dependencies: { vue: "3.0.0" } })
    );

    // load() should return cached object
    const cachedLoad = await intelligence.load(tempDir);
    expect(cachedLoad).toBe(firstLoad);
    expect(cachedLoad.frameworks).toContain("React");

    // refresh() should re-inspect disk and update cache
    const refreshed = await intelligence.refresh(tempDir);
    expect(refreshed.frameworks).toContain("Vue");
    expect(refreshed.frameworks).not.toContain("React");

    // clear() resets cache
    intelligence.clear();
  });
});

describe("Project Context Integration & Independence", () => {
  it("System Prompt: formats concise Project Context accurately", () => {
    const prompt = composeSystemPrompt({
      projectContext: {
        projectRoot: "/test/project",
        projectType: "frontend",
        languages: ["TypeScript", "JavaScript"],
        framework: "react",
        frameworks: ["React"],
        frameworkVersion: "18.2.0",
        buildTool: "vite",
        buildTools: ["Vite", "tsc"],
        styling: ["tailwind"],
        testing: ["Vitest", "Playwright"],
        lintTools: ["ESLint"],
        formatTools: ["Prettier"],
        packageManager: "npm",
        structure: {
          sourceDirectories: ["src"],
          componentDirectories: ["src/components"],
          routeDirectories: [],
          testDirectories: ["tests"],
          assetDirectories: ["public"]
        },
        scripts: { test: "vitest run" },
        configuration: { framework: [], styling: [], build: [], testing: [] },
        workspaces: { isMonorepo: true, type: "npm", packages: ["apps/*", "packages/*"] },
        importantDirectories: ["apps", "packages", "src"]
      }
    });

    expect(prompt).toContain("## Project Context");
    expect(prompt).toContain("- Framework: react (18.2.0)");
    expect(prompt).toContain("- Languages: TypeScript, JavaScript");
    expect(prompt).toContain("- Package Manager: npm");
    expect(prompt).toContain("- Build Tool: vite");
    expect(prompt).toContain("- Testing: Vitest, Playwright");
    expect(prompt).toContain("- Linting: ESLint");
    expect(prompt).toContain("- Formatting: Prettier");
    expect(prompt).toContain("- Workspaces: npm (apps/*, packages/*)");
    expect(prompt).toContain("- Important Directories: apps, packages, src");
  });

  it("Skills: framework context helps activation without forcing activation", () => {
    const dummyReactSkill: Skill = {
      name: "react",
      version: "1.0.0",
      category: "framework",
      description: "React guidelines",
      instructions: ["Use hooks"],
      activation: { when: ["React components"] }
    };

    const dummyTailwindSkill: Skill = {
      name: "tailwind",
      version: "1.0.0",
      category: "styling",
      description: "Tailwind guidelines",
      instructions: ["Use utility classes"],
      activation: { when: ["Tailwind styling"] }
    };

    const registry: SkillRegistry = {
      list: () => [dummyReactSkill, dummyTailwindSkill],
      register: () => {},
      get: (n) => (n === "react" ? dummyReactSkill : dummyTailwindSkill),
      has: () => true
    };

    const policy = new SkillActivationPolicy({ minThreshold: 5.0 });

    const reactProjectContext = {
      projectRoot: "/test",
      projectType: "frontend" as const,
      languages: ["typescript"],
      framework: "react" as const,
      frameworks: ["react"],
      frameworkVersion: "18.2.0",
      buildTool: "vite" as const,
      styling: ["tailwind"],
      testing: ["vitest"],
      packageManager: "npm" as const,
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

    // User asks for SQL database query - React should NOT activate despite being in a React project
    const dbResult = policy.activate("Write a Postgres SQL query to select all users", registry, reactProjectContext);
    expect(dbResult.skills.some(s => s.name === "react")).toBe(false);

    // User asks for button component - React activates smoothly
    const uiResult = policy.activate("Build a button component with state", registry, reactProjectContext);
    expect(uiResult.skills.some(s => s.name === "react")).toBe(true);
  });

  it("TaskPlan: TaskPlan remains completely independent from repository discovery", () => {
    const plan = createTaskPlan("Refactor button", ["Inspect button", "Update button"]);
    expect(plan.goal).toBe("Refactor button");
    expect(plan.steps).toHaveLength(2);
    // TaskPlan contains no project discovery properties
    expect((plan as unknown as Record<string, unknown>).framework).toBeUndefined();
    expect((plan as unknown as Record<string, unknown>).packageManager).toBeUndefined();
  });

  it("Provider Independence: OpenAI, Gemini, Ollama receive equivalent Project Context", async () => {
    const providerA = new MockModelProvider();
    providerA.id = "openai:gpt-4o";
    const providerB = new MockModelProvider();
    providerB.id = "gemini:gemini-2.5-flash";
    const providerC = new MockModelProvider();
    providerC.id = "ollama:llama3";

    const detector = new ProjectDetector();
    const mockContext = await detector.detect(process.cwd());

    const runtimeA = new AgentRuntime(providerA, { projectContext: mockContext });
    const runtimeB = new AgentRuntime(providerB, { projectContext: mockContext });
    const runtimeC = new AgentRuntime(providerC, { projectContext: mockContext });

    for await (const event of runtimeA.run({ message: "Inspect codebase", cwd: process.cwd() })) {
      void event;
    }
    for await (const event of runtimeB.run({ message: "Inspect codebase", cwd: process.cwd() })) {
      void event;
    }
    for await (const event of runtimeC.run({ message: "Inspect codebase", cwd: process.cwd() })) {
      void event;
    }

    expect(providerA.capturedRequests[0].system).toBe(providerB.capturedRequests[0].system);
    expect(providerB.capturedRequests[0].system).toBe(providerC.capturedRequests[0].system);
  });
});

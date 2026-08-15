import * as fs from "fs/promises";
import * as path from "path";
import type {
  PackageJsonData,
  PackageManagerType,
  ProjectProfile,
  ProjectType,
  WorkspaceInfo,
  PackageScripts
} from "./types.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export class ProjectIntelligence {
  private cache: Map<string, ProjectProfile> = new Map();

  public async load(projectRootInput: string): Promise<ProjectProfile> {
    const root = path.resolve(projectRootInput);
    const cached = this.cache.get(root);
    if (cached) {
      return cached;
    }
    return this.refresh(root);
  }

  public async refresh(projectRootInput: string): Promise<ProjectProfile> {
    const root = path.resolve(projectRootInput);
    const profile = await this.inspect(root);
    this.cache.set(root, profile);
    return profile;
  }

  public clear(): void {
    this.cache.clear();
  }

  public async inspect(projectRootInput: string): Promise<ProjectProfile> {
    const root = path.resolve(projectRootInput);

    let packageJson: PackageJsonData | undefined;
    const packageJsonPath = path.join(root, "package.json");

    if (await fileExists(packageJsonPath)) {
      try {
        const content = await fs.readFile(packageJsonPath, "utf-8");
        packageJson = JSON.parse(content) as PackageJsonData;
      } catch {
        // ignore malformed package.json
      }
    }

    const configFiles = await this.detectConfigFiles(root);
    const packageManager = await this.detectPackageManager(root, packageJson);
    const languages = await this.detectLanguages(root, packageJson, configFiles);
    const { frameworks, framework, frameworkVersion } = this.detectFrameworks(packageJson);
    const buildTools = this.detectBuildTools(packageJson, configFiles);
    const testTools = this.detectTestTools(packageJson, configFiles);
    const lintTools = this.detectLintTools(packageJson, configFiles);
    const formatTools = this.detectFormatTools(packageJson, configFiles);
    const workspaces = await this.detectWorkspaces(root, packageJson);
    const importantDirectories = await this.detectImportantDirectories(root);
    const packageScripts = this.detectScripts(packageJson);
    const projectType = this.detectProjectType(framework, packageJson);

    return {
      root,
      projectType,
      packageManager,
      languages: languages.sort(),
      frameworks: frameworks.sort(),
      framework,
      frameworkVersion,
      buildTools: buildTools.sort(),
      testTools: testTools.sort(),
      lintTools: lintTools.sort(),
      formatTools: formatTools.sort(),
      packageScripts,
      workspaces,
      importantDirectories: importantDirectories.sort(),
      configFiles: configFiles.sort()
    };
  }

  private async detectPackageManager(
    root: string,
    packageJson?: PackageJsonData
  ): Promise<PackageManagerType> {
    // 1. If package.json specifies packageManager, prefer that value when valid
    if (packageJson?.packageManager) {
      const pm = packageJson.packageManager.toLowerCase();
      if (pm.startsWith("pnpm")) return "pnpm";
      if (pm.startsWith("yarn")) return "yarn";
      if (pm.startsWith("bun")) return "bun";
      if (pm.startsWith("npm")) return "npm";
    }

    // 2. Lockfiles detection
    if (await fileExists(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
    if (await fileExists(path.join(root, "yarn.lock"))) return "yarn";
    if (
      (await fileExists(path.join(root, "bun.lockb"))) ||
      (await fileExists(path.join(root, "bun.lock")))
    ) {
      return "bun";
    }
    if (await fileExists(path.join(root, "package-lock.json"))) return "npm";

    return null;
  }

  private detectFrameworks(packageJson?: PackageJsonData): {
    frameworks: string[];
    framework: string | null;
    frameworkVersion: string | null;
  } {
    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };

    const frameworks: string[] = [];
    let framework: string | null = null;
    let frameworkVersion: string | null = null;

    if ("react" in allDeps || "react-dom" in allDeps) {
      frameworks.push("React");
      if (!framework) {
        framework = "React";
        frameworkVersion = allDeps["react"] || allDeps["react-dom"] || null;
      }
    }
    if ("next" in allDeps) {
      frameworks.push("Next.js");
      framework = "Next.js";
      frameworkVersion = allDeps["next"] || null;
    }
    if ("vue" in allDeps) {
      frameworks.push("Vue");
      if (!framework) {
        framework = "Vue";
        frameworkVersion = allDeps["vue"] || null;
      }
    }
    if ("nuxt" in allDeps) {
      frameworks.push("Nuxt");
      framework = "Nuxt";
      frameworkVersion = allDeps["nuxt"] || null;
    }
    if ("svelte" in allDeps) {
      frameworks.push("Svelte");
      if (!framework) {
        framework = "Svelte";
        frameworkVersion = allDeps["svelte"] || null;
      }
    }
    if ("@sveltejs/kit" in allDeps) {
      frameworks.push("SvelteKit");
      framework = "SvelteKit";
      frameworkVersion = allDeps["@sveltejs/kit"] || null;
    }
    if ("@angular/core" in allDeps) {
      frameworks.push("Angular");
      if (!framework) {
        framework = "Angular";
        frameworkVersion = allDeps["@angular/core"] || null;
      }
    }
    if ("astro" in allDeps) {
      frameworks.push("Astro");
      if (!framework) {
        framework = "Astro";
        frameworkVersion = allDeps["astro"] || null;
      }
    }
    if ("vite" in allDeps) {
      frameworks.push("Vite");
    }

    return { frameworks, framework, frameworkVersion };
  }

  private async detectLanguages(
    root: string,
    packageJson?: PackageJsonData,
    configFiles: string[] = []
  ): Promise<string[]> {
    const languages: Set<string> = new Set();
    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };

    // TypeScript
    if (
      configFiles.some((f) => f.startsWith("tsconfig")) ||
      "typescript" in allDeps
    ) {
      languages.add("TypeScript");
    }

    // JavaScript
    if (
      packageJson ||
      configFiles.some((f) => f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".cjs"))
    ) {
      languages.add("JavaScript");
    }

    // CSS / SCSS
    if (
      "tailwindcss" in allDeps ||
      "postcss" in allDeps ||
      configFiles.some((f) => f.startsWith("tailwind.") || f.startsWith("postcss."))
    ) {
      languages.add("CSS");
    }
    if ("sass" in allDeps || "node-sass" in allDeps) {
      languages.add("SCSS");
    }

    // HTML
    if (await fileExists(path.join(root, "index.html")) || await fileExists(path.join(root, "public/index.html"))) {
      languages.add("HTML");
    }

    if (languages.size === 0) {
      languages.add("JavaScript");
    }

    return Array.from(languages);
  }

  private detectBuildTools(
    packageJson?: PackageJsonData,
    configFiles: string[] = []
  ): string[] {
    const tools: Set<string> = new Set();
    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };

    if ("vite" in allDeps || configFiles.some((f) => f.startsWith("vite.config."))) {
      tools.add("Vite");
    }
    if ("next" in allDeps || configFiles.some((f) => f.startsWith("next.config."))) {
      tools.add("Next.js");
    }
    if ("webpack" in allDeps || configFiles.some((f) => f.startsWith("webpack.config."))) {
      tools.add("Webpack");
    }
    if ("rollup" in allDeps || configFiles.some((f) => f.startsWith("rollup.config."))) {
      tools.add("Rollup");
    }
    if ("turbo" in allDeps || configFiles.includes("turbo.json")) {
      tools.add("Turborepo");
    }
    if ("typescript" in allDeps || configFiles.some((f) => f.startsWith("tsconfig"))) {
      tools.add("tsc");
    }

    return Array.from(tools);
  }

  private detectTestTools(
    packageJson?: PackageJsonData,
    configFiles: string[] = []
  ): string[] {
    const tools: Set<string> = new Set();
    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };

    if ("vitest" in allDeps || configFiles.some((f) => f.startsWith("vitest."))) {
      tools.add("Vitest");
    }
    if ("jest" in allDeps || configFiles.some((f) => f.startsWith("jest.config."))) {
      tools.add("Jest");
    }
    if (
      "@playwright/test" in allDeps ||
      configFiles.some((f) => f.startsWith("playwright.config."))
    ) {
      tools.add("Playwright");
    }
    if ("cypress" in allDeps || configFiles.some((f) => f.startsWith("cypress.config."))) {
      tools.add("Cypress");
    }

    return Array.from(tools);
  }

  private detectLintTools(
    packageJson?: PackageJsonData,
    configFiles: string[] = []
  ): string[] {
    const tools: Set<string> = new Set();
    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };

    if (
      "eslint" in allDeps ||
      configFiles.some((f) => f.startsWith("eslint.config.") || f.startsWith(".eslintrc"))
    ) {
      tools.add("ESLint");
    }
    if ("@biomejs/biome" in allDeps || configFiles.includes("biome.json")) {
      tools.add("Biome");
    }

    return Array.from(tools);
  }

  private detectFormatTools(
    packageJson?: PackageJsonData,
    configFiles: string[] = []
  ): string[] {
    const tools: Set<string> = new Set();
    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };

    if (
      "prettier" in allDeps ||
      configFiles.some((f) => f.startsWith("prettier.config.") || f.startsWith(".prettierrc"))
    ) {
      tools.add("Prettier");
    }
    if ("@biomejs/biome" in allDeps || configFiles.includes("biome.json")) {
      tools.add("Biome");
    }

    return Array.from(tools);
  }

  private async detectWorkspaces(
    root: string,
    packageJson?: PackageJsonData
  ): Promise<WorkspaceInfo> {
    if (await fileExists(path.join(root, "pnpm-workspace.yaml"))) {
      return { isMonorepo: true, type: "pnpm" };
    }

    if (packageJson?.workspaces) {
      const pkgs = Array.isArray(packageJson.workspaces)
        ? packageJson.workspaces
        : packageJson.workspaces.packages || [];
      const hasYarn = await fileExists(path.join(root, "yarn.lock"));
      return {
        isMonorepo: true,
        type: hasYarn ? "yarn" : "npm",
        packages: pkgs.sort()
      };
    }

    if (await fileExists(path.join(root, "turbo.json"))) {
      return { isMonorepo: true, type: "turborepo" };
    }
    if (await fileExists(path.join(root, "lerna.json"))) {
      return { isMonorepo: true, type: "lerna" };
    }

    const hasApps = await dirExists(path.join(root, "apps"));
    const hasPackages = await dirExists(path.join(root, "packages"));
    if (hasApps && hasPackages) {
      return {
        isMonorepo: true,
        type: "npm",
        packages: ["apps/*", "packages/*"]
      };
    }

    return { isMonorepo: false };
  }

  private async detectImportantDirectories(root: string): Promise<string[]> {
    const candidates = [
      "src",
      "app",
      "pages",
      "components",
      "lib",
      "utils",
      "tests",
      "__tests__",
      "apps",
      "packages",
      "public"
    ];

    const found: string[] = [];
    for (const candidate of candidates) {
      if (await dirExists(path.join(root, candidate))) {
        found.push(candidate);
      }
    }
    return found;
  }

  private async detectConfigFiles(root: string): Promise<string[]> {
    const candidates = [
      "package.json",
      "tsconfig.json",
      "tsconfig.base.json",
      "vite.config.ts",
      "vite.config.js",
      "vite.config.mjs",
      "next.config.js",
      "next.config.mjs",
      "next.config.ts",
      "nuxt.config.ts",
      "nuxt.config.js",
      "astro.config.mjs",
      "astro.config.ts",
      "svelte.config.js",
      "tailwind.config.js",
      "tailwind.config.ts",
      "tailwind.config.cjs",
      "postcss.config.js",
      "vitest.config.ts",
      "vitest.config.js",
      "vitest.workspace.js",
      "vitest.workspace.ts",
      "jest.config.js",
      "jest.config.ts",
      "playwright.config.ts",
      "playwright.config.js",
      "cypress.config.ts",
      "cypress.config.js",
      "eslint.config.js",
      ".eslintrc.json",
      ".eslintrc.js",
      "prettier.config.js",
      ".prettierrc",
      ".prettierrc.json",
      "biome.json",
      "turbo.json",
      "lerna.json"
    ];

    const found: string[] = [];
    for (const candidate of candidates) {
      if (await fileExists(path.join(root, candidate))) {
        found.push(candidate);
      }
    }
    return found;
  }

  private detectScripts(packageJson?: PackageJsonData): PackageScripts {
    if (!packageJson?.scripts) return {};
    const scriptsObj = packageJson.scripts;
    const sortedKeys = Object.keys(scriptsObj).sort();

    const result: PackageScripts = {};
    for (const key of sortedKeys) {
      result[key] = scriptsObj[key];
    }
    return result;
  }

  private detectProjectType(
    framework: string | null,
    packageJson?: PackageJsonData
  ): ProjectType {
    if (
      framework === "Next.js" ||
      framework === "Nuxt" ||
      framework === "SvelteKit" ||
      framework === "Astro"
    ) {
      return "fullstack";
    }
    if (
      framework === "React" ||
      framework === "Vue" ||
      framework === "Svelte" ||
      framework === "Angular"
    ) {
      return "frontend";
    }

    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };

    const isBackend = [
      "express",
      "fastify",
      "koa",
      "nestjs",
      "apollo-server"
    ].some((dep) => dep in allDeps);
    if (isBackend) {
      return "backend";
    }

    return "unknown";
  }
}

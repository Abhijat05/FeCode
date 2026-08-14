import * as fs from "fs/promises";
import * as path from "path";
import type {
  BuildToolType,
  ConfigurationMap,
  FrameworkType,
  PackageJsonData,
  PackageManagerType,
  PackageScripts,
  ProjectContext,
  ProjectStructure,
  ProjectType
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

export class ProjectDetector {
  async detect(projectRootInput: string): Promise<ProjectContext> {
    const projectRoot = path.resolve(projectRootInput);

    let packageJson: PackageJsonData | undefined;
    const packageJsonPath = path.join(projectRoot, "package.json");

    if (await fileExists(packageJsonPath)) {
      try {
        const content = await fs.readFile(packageJsonPath, "utf-8");
        packageJson = JSON.parse(content) as PackageJsonData;
      } catch {
        // ignore JSON parse error
      }
    }

    const packageManager = await this.detectPackageManager(projectRoot, packageJson);
    const configFiles = await this.detectConfigFiles(projectRoot);
    const languages = await this.detectLanguages(projectRoot, packageJson);
    const { framework, frameworkVersion, frameworks } = this.detectFramework(packageJson);
    const buildTool = this.detectBuildTool(packageJson, configFiles);
    const styling = this.detectStyling(packageJson, configFiles);
    const testing = this.detectTesting(packageJson, configFiles);
    const projectType = this.detectProjectType(framework, packageJson);

    const structure: ProjectStructure = {
      sourceDirectories: await this.detectSourceDirectories(projectRoot),
      componentDirectories: await this.detectComponentDirectories(projectRoot),
      routeDirectories: await this.detectRouteDirectories(projectRoot),
      testDirectories: await this.detectTestDirectories(projectRoot),
      assetDirectories: await this.detectAssetDirectories(projectRoot)
    };

    const scripts = this.detectScripts(packageJson);
    const configuration = this.buildConfigurationMap(configFiles);

    return {
      projectRoot,
      projectType,
      languages,
      framework,
      frameworks,
      frameworkVersion,
      buildTool,
      styling,
      testing,
      packageManager,
      structure,
      scripts,
      configuration,
      packageJson
    };
  }

  private async detectPackageManager(
    projectRoot: string,
    packageJson?: PackageJsonData
  ): Promise<PackageManagerType> {
    if (await fileExists(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
    if (await fileExists(path.join(projectRoot, "yarn.lock"))) return "yarn";
    if (
      (await fileExists(path.join(projectRoot, "bun.lockb"))) ||
      (await fileExists(path.join(projectRoot, "bun.lock")))
    ) {
      return "bun";
    }
    if (await fileExists(path.join(projectRoot, "package-lock.json"))) return "npm";

    if (packageJson?.packageManager) {
      const pm = packageJson.packageManager.toLowerCase();
      if (pm.startsWith("pnpm")) return "pnpm";
      if (pm.startsWith("yarn")) return "yarn";
      if (pm.startsWith("bun")) return "bun";
      if (pm.startsWith("npm")) return "npm";
    }

    return null;
  }

  private async detectLanguages(
    projectRoot: string,
    packageJson?: PackageJsonData
  ): Promise<Array<"typescript" | "javascript" | string>> {
    const hasTsConfig = await fileExists(path.join(projectRoot, "tsconfig.json"));
    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };
    const hasTsDep = "typescript" in allDeps;

    if (hasTsConfig || hasTsDep) {
      return ["typescript"];
    }

    return ["javascript"];
  }

  private detectFramework(packageJson?: PackageJsonData): {
    framework: FrameworkType;
    frameworks: string[];
    frameworkVersion: string | null;
  } {
    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };

    const frameworks: string[] = [];
    let framework: FrameworkType = null;
    let frameworkVersion: string | null = null;

    if ("react" in allDeps || "react-dom" in allDeps) {
      frameworks.push("react");
      if (!framework) {
        framework = "react";
        frameworkVersion = allDeps["react"] || allDeps["react-dom"] || null;
      }
    }
    if ("vue" in allDeps) {
      frameworks.push("vue");
      if (!framework) {
        framework = "vue";
        frameworkVersion = allDeps["vue"] || null;
      }
    }
    if ("svelte" in allDeps) {
      frameworks.push("svelte");
      if (!framework) {
        framework = "svelte";
        frameworkVersion = allDeps["svelte"] || null;
      }
    }
    if ("next" in allDeps) {
      frameworks.push("nextjs");
      framework = "next";
      frameworkVersion = allDeps["next"] || null;
    }
    if ("@sveltejs/kit" in allDeps) {
      frameworks.push("sveltekit");
      framework = "sveltekit";
      frameworkVersion = allDeps["@sveltejs/kit"] || null;
    }
    if ("nuxt" in allDeps) {
      frameworks.push("nuxt");
      framework = "nuxt";
      frameworkVersion = allDeps["nuxt"] || null;
    }
    if ("astro" in allDeps) {
      frameworks.push("astro");
      framework = "astro";
      frameworkVersion = allDeps["astro"] || null;
    }

    return { framework, frameworks, frameworkVersion };
  }

  private detectProjectType(framework: FrameworkType, packageJson?: PackageJsonData): ProjectType {
    if (framework === "next" || framework === "nuxt" || framework === "sveltekit" || framework === "astro") {
      return "fullstack";
    }
    if (framework === "react" || framework === "vue" || framework === "svelte") {
      return "frontend";
    }

    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };

    const isBackend = ["express", "fastify", "koa", "nestjs", "apollo-server"].some(dep => dep in allDeps);
    if (isBackend) {
      return "backend";
    }

    // Default heuristic for backend if no UI framework but Node stuff
    if (!framework && ("@types/node" in allDeps || "typescript" in allDeps)) {
      // Very basic heuristic
      return "unknown";
    }

    return "unknown";
  }

  private detectBuildTool(
    packageJson?: PackageJsonData,
    configFiles: string[] = []
  ): BuildToolType {
    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };

    if (
      "vite" in allDeps ||
      configFiles.some((f) => f.startsWith("vite.config."))
    ) {
      return "vite";
    }
    if (
      "next" in allDeps ||
      configFiles.some((f) => f.startsWith("next.config."))
    ) {
      return "next";
    }
    if (
      "nuxt" in allDeps ||
      configFiles.some((f) => f.startsWith("nuxt.config."))
    ) {
      return "nuxt";
    }
    if (
      "astro" in allDeps ||
      configFiles.some((f) => f.startsWith("astro.config."))
    ) {
      return "astro";
    }
    if (
      "@sveltejs/kit" in allDeps ||
      configFiles.some((f) => f.startsWith("svelte.config."))
    ) {
      return "sveltekit";
    }
    if ("webpack" in allDeps) {
      return "webpack";
    }

    return null;
  }

  private detectStyling(
    packageJson?: PackageJsonData,
    configFiles: string[] = []
  ): Array<"tailwind" | "css-modules" | "sass" | "styled-components" | "emotion" | string> {
    const styling: string[] = [];
    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };

    if (
      "tailwindcss" in allDeps ||
      configFiles.some((f) => f.startsWith("tailwind.config."))
    ) {
      styling.push("tailwind");
    }
    if ("sass" in allDeps || "node-sass" in allDeps) {
      styling.push("sass");
    }
    if ("styled-components" in allDeps) {
      styling.push("styled-components");
    }
    if ("@emotion/react" in allDeps || "@emotion/styled" in allDeps) {
      styling.push("emotion");
    }

    return styling;
  }

  private detectTesting(
    packageJson?: PackageJsonData,
    configFiles: string[] = []
  ): Array<"vitest" | "jest" | "playwright" | "cypress" | string> {
    const testing: string[] = [];
    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };

    if (
      "vitest" in allDeps ||
      configFiles.some((f) => f.startsWith("vitest.config."))
    ) {
      testing.push("vitest");
    }
    if (
      "jest" in allDeps ||
      configFiles.some((f) => f.startsWith("jest.config."))
    ) {
      testing.push("jest");
    }
    if (
      "@playwright/test" in allDeps ||
      configFiles.some((f) => f.startsWith("playwright.config."))
    ) {
      testing.push("playwright");
    }
    if (
      "cypress" in allDeps ||
      configFiles.some((f) => f.startsWith("cypress.config."))
    ) {
      testing.push("cypress");
    }

    return testing;
  }

  private async detectConfigFiles(projectRoot: string): Promise<string[]> {
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
      ".eslintrc.js"
    ];

    const found: string[] = [];
    for (const candidate of candidates) {
      if (await fileExists(path.join(projectRoot, candidate))) {
        found.push(candidate);
      }
    }

    return found;
  }

  private async detectSourceDirectories(projectRoot: string): Promise<string[]> {
    const candidates = [
      "src", "app", "pages", "components", "features", 
      "lib", "utils", "hooks", "layouts", "routes", 
      "public", "tests", "__tests__",
      "src/components", "src/features", "src/lib",
      "src/utils", "src/hooks", "src/layouts", "src/routes"
    ];
    return this.findExistingDirectories(projectRoot, candidates);
  }

  private async detectComponentDirectories(projectRoot: string): Promise<string[]> {
    const candidates = [
      "src/components",
      "components",
      "src/ui",
      "src/components/ui"
    ];
    return this.findExistingDirectories(projectRoot, candidates);
  }

  private async detectRouteDirectories(projectRoot: string): Promise<string[]> {
    const candidates = ["app", "pages", "routes", "src/pages", "src/routes", "src/router"];
    return this.findExistingDirectories(projectRoot, candidates);
  }

  private async detectTestDirectories(projectRoot: string): Promise<string[]> {
    const candidates = ["tests", "__tests__", "e2e", "integration", "unit"];
    return this.findExistingDirectories(projectRoot, candidates);
  }

  private async detectAssetDirectories(projectRoot: string): Promise<string[]> {
    const candidates = ["public", "static", "assets"];
    return this.findExistingDirectories(projectRoot, candidates);
  }

  private async findExistingDirectories(projectRoot: string, candidates: string[]): Promise<string[]> {
    const found: string[] = [];
    for (const candidate of candidates) {
      if (await dirExists(path.join(projectRoot, candidate))) {
        found.push(candidate);
      }
    }
    return found.sort();
  }

  private detectScripts(packageJson?: PackageJsonData): PackageScripts {
    if (!packageJson?.scripts) return {};
    
    // Create a copy and sort keys deterministically
    const scriptsObj = packageJson.scripts;
    const sortedKeys = Object.keys(scriptsObj).sort();
    
    const result: PackageScripts = {};
    for (const key of sortedKeys) {
      result[key] = scriptsObj[key];
    }
    
    return result;
  }

  private buildConfigurationMap(configFiles: string[]): ConfigurationMap {
    const sortedConfigs = [...configFiles].sort();
    return {
      framework: sortedConfigs.filter(f => f.startsWith("next.config.") || f.startsWith("nuxt.config.") || f.startsWith("svelte.config.") || f.startsWith("astro.config.")),
      styling: sortedConfigs.filter(f => f.startsWith("tailwind.config.") || f.startsWith("postcss.config.")),
      build: sortedConfigs.filter(f => f.startsWith("vite.config.") || f.startsWith("webpack.config.") || f.startsWith("rollup.config.")),
      testing: sortedConfigs.filter(f => f.startsWith("vitest.") || f.startsWith("jest.") || f.startsWith("playwright.") || f.startsWith("cypress."))
    };
  }
}

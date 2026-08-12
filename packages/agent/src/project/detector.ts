import * as fs from "fs/promises";
import * as path from "path";
import type {
  BuildToolType,
  FrameworkType,
  PackageJsonData,
  PackageManagerType,
  ProjectContext
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
    const { framework, frameworkVersion } = this.detectFramework(packageJson);
    const buildTool = this.detectBuildTool(packageJson, configFiles);
    const styling = this.detectStyling(packageJson, configFiles);
    const testing = this.detectTesting(packageJson, configFiles);
    const sourceDirectories = await this.detectSourceDirectories(projectRoot);
    const componentDirectories = await this.detectComponentDirectories(projectRoot);

    return {
      projectRoot,
      languages,
      framework,
      frameworkVersion,
      buildTool,
      styling,
      testing,
      packageManager,
      sourceDirectories,
      componentDirectories,
      configFiles,
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
    frameworkVersion: string | null;
  } {
    const allDeps = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };

    if ("next" in allDeps) {
      return { framework: "next", frameworkVersion: allDeps["next"] || null };
    }
    if ("@sveltejs/kit" in allDeps) {
      return {
        framework: "sveltekit",
        frameworkVersion: allDeps["@sveltejs/kit"] || null
      };
    }
    if ("nuxt" in allDeps) {
      return { framework: "nuxt", frameworkVersion: allDeps["nuxt"] || null };
    }
    if ("astro" in allDeps) {
      return { framework: "astro", frameworkVersion: allDeps["astro"] || null };
    }
    if ("react" in allDeps || "react-dom" in allDeps) {
      return {
        framework: "react",
        frameworkVersion: allDeps["react"] || allDeps["react-dom"] || null
      };
    }
    if ("vue" in allDeps) {
      return { framework: "vue", frameworkVersion: allDeps["vue"] || null };
    }
    if ("svelte" in allDeps) {
      return { framework: "svelte", frameworkVersion: allDeps["svelte"] || null };
    }

    return { framework: null, frameworkVersion: null };
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
    const candidates = ["src", "app", "pages", "lib"];
    const found: string[] = [];

    for (const candidate of candidates) {
      if (await dirExists(path.join(projectRoot, candidate))) {
        found.push(candidate);
      }
    }

    return found;
  }

  private async detectComponentDirectories(projectRoot: string): Promise<string[]> {
    const candidates = [
      "src/components",
      "app/components",
      "components",
      "pages/components"
    ];
    const found: string[] = [];

    for (const candidate of candidates) {
      if (await dirExists(path.join(projectRoot, candidate))) {
        found.push(candidate);
      }
    }

    return found;
  }
}

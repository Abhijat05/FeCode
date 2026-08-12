export interface PackageJsonData {
  name?: string;
  version?: string;
  private?: boolean;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

export type FrameworkType =
  | "react"
  | "next"
  | "vue"
  | "nuxt"
  | "svelte"
  | "sveltekit"
  | "astro"
  | null;

export type BuildToolType =
  | "vite"
  | "next"
  | "nuxt"
  | "astro"
  | "sveltekit"
  | "webpack"
  | null;

export type PackageManagerType = "npm" | "pnpm" | "yarn" | "bun" | null;

export interface ProjectContext {
  projectRoot: string;
  languages: Array<"typescript" | "javascript" | string>;
  framework: FrameworkType;
  frameworkVersion: string | null;
  buildTool: BuildToolType;
  styling: Array<"tailwind" | "css-modules" | "sass" | "styled-components" | "emotion" | string>;
  testing: Array<"vitest" | "jest" | "playwright" | "cypress" | string>;
  packageManager: PackageManagerType;
  sourceDirectories: string[];
  componentDirectories: string[];
  configFiles: string[];
  packageJson?: PackageJsonData;
}

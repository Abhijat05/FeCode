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

export type ProjectType = "frontend" | "backend" | "fullstack" | "unknown";

export interface ProjectStructure {
  sourceDirectories: string[];
  componentDirectories: string[];
  routeDirectories: string[];
  testDirectories: string[];
  assetDirectories: string[];
}

export interface ConfigurationMap {
  framework: string[];
  styling: string[];
  build: string[];
  testing: string[];
}

export interface PackageScripts {
  dev?: string;
  build?: string;
  test?: string;
  lint?: string;
  typecheck?: string;
  [key: string]: string | undefined;
}

export interface ProjectContext {
  projectRoot: string;
  projectType: ProjectType;
  languages: Array<"typescript" | "javascript" | string>;
  framework: FrameworkType;
  frameworks: string[];
  frameworkVersion: string | null;
  buildTool: BuildToolType;
  styling: Array<"tailwind" | "css-modules" | "sass" | "styled-components" | "emotion" | string>;
  testing: Array<"vitest" | "jest" | "playwright" | "cypress" | string>;
  packageManager: PackageManagerType;
  structure: ProjectStructure;
  scripts: PackageScripts;
  configuration: ConfigurationMap;
  packageJson?: PackageJsonData;
}

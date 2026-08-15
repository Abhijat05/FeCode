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
  | "angular"
  | null;

export type BuildToolType =
  | "vite"
  | "next"
  | "nuxt"
  | "astro"
  | "sveltekit"
  | "webpack"
  | "rollup"
  | "turborepo"
  | "tsc"
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
  format?: string;
  typecheck?: string;
  [key: string]: string | undefined;
}

export interface WorkspaceInfo {
  isMonorepo: boolean;
  type?: "npm" | "pnpm" | "yarn" | "turborepo" | "lerna" | null;
  packages?: string[];
}

export interface ProjectProfile {
  root: string;
  projectType: ProjectType;
  packageManager: PackageManagerType;
  languages: string[];
  frameworks: string[];
  framework?: string | null;
  frameworkVersion?: string | null;
  buildTools: string[];
  testTools: string[];
  lintTools: string[];
  formatTools: string[];
  packageScripts: PackageScripts;
  workspaces: WorkspaceInfo;
  importantDirectories: string[];
  configFiles: string[];
}

export interface ProjectContext {
  projectRoot: string;
  projectType: ProjectType;
  languages: Array<"typescript" | "javascript" | string>;
  framework: FrameworkType;
  frameworks: string[];
  frameworkVersion: string | null;
  buildTool: BuildToolType;
  buildTools?: string[];
  styling: Array<"tailwind" | "css-modules" | "sass" | "styled-components" | "emotion" | string>;
  testing: Array<"vitest" | "jest" | "playwright" | "cypress" | string>;
  testTools?: string[];
  lintTools?: string[];
  formatTools?: string[];
  packageManager: PackageManagerType;
  structure: ProjectStructure;
  scripts: PackageScripts;
  configuration: ConfigurationMap;
  packageJson?: PackageJsonData;
  workspaces?: WorkspaceInfo;
  importantDirectories?: string[];
  configFiles?: string[];
  profile?: ProjectProfile;
}

export const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "coverage",
  ".cache",
  ".turbo",
  "out",
  "vendor"
]);

export const DEFAULT_IGNORED_FILES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock"
]);

export function isIgnoredDirectory(dirName: string): boolean {
  return DEFAULT_IGNORED_DIRS.has(dirName);
}

export function isIgnoredFile(fileName: string): boolean {
  return DEFAULT_IGNORED_FILES.has(fileName);
}

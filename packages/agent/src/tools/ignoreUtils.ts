import * as fs from "fs/promises";
import * as path from "path";

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

export interface GitignoreMatcher {
  isIgnored(relPath: string, isDirectory: boolean): boolean;
}

export function parseGitignoreContent(content: string): GitignoreMatcher {
  const lines = content.split(/\r?\n/);
  const rules: { regex: RegExp; isDirOnly: boolean; isNegative: boolean }[] = [];

  for (const raw of lines) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const isNegative = line.startsWith("!");
    if (isNegative) line = line.slice(1).trim();

    const isDirOnly = line.endsWith("/");
    if (isDirOnly) line = line.slice(0, -1);

    let glob = line.replace(/\\/g, "/");
    const isRooted = glob.startsWith("/");
    if (isRooted) glob = glob.slice(1);

    let regexStr = glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "<<GLOBSTAR>>")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/<<GLOBSTAR>>/g, ".*");

    if (isRooted) {
      regexStr = "^" + regexStr;
    } else {
      regexStr = "(^|/)" + regexStr;
    }
    regexStr += "($|/)";

    try {
      rules.push({
        regex: new RegExp(regexStr),
        isDirOnly,
        isNegative
      });
    } catch {
      // ignore invalid regex patterns
    }
  }

  return {
    isIgnored(relPath: string, isDirectory: boolean): boolean {
      const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
      let ignored = false;
      for (const rule of rules) {
        if (rule.isDirOnly && !isDirectory) continue;
        if (rule.regex.test(normalized)) {
          ignored = !rule.isNegative;
        }
      }
      return ignored;
    }
  };
}

export async function loadGitignore(rootDir: string): Promise<GitignoreMatcher | null> {
  try {
    const gitignorePath = path.join(rootDir, ".gitignore");
    const content = await fs.readFile(gitignorePath, "utf-8");
    return parseGitignoreContent(content);
  } catch {
    return null;
  }
}

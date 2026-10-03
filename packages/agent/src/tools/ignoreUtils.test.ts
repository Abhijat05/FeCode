import { describe, it, expect } from "vitest";
import {
  isIgnoredDirectory,
  isIgnoredFile,
  DEFAULT_IGNORED_DIRS,
  DEFAULT_IGNORED_FILES,
  parseGitignoreContent
} from "./ignoreUtils.js";

describe("ignoreUtils", () => {
  it("identifies common generated and dependency directories to ignore", () => {
    expect(isIgnoredDirectory("node_modules")).toBe(true);
    expect(isIgnoredDirectory(".git")).toBe(true);
    expect(isIgnoredDirectory("dist")).toBe(true);
    expect(isIgnoredDirectory("build")).toBe(true);
    expect(isIgnoredDirectory(".next")).toBe(true);
    expect(isIgnoredDirectory("src")).toBe(false);
    expect(isIgnoredDirectory("components")).toBe(false);
  });

  it("identifies common lockfiles and sensitive files to ignore during broad search", () => {
    expect(isIgnoredFile(".env")).toBe(true);
    expect(isIgnoredFile(".env.local")).toBe(true);
    expect(isIgnoredFile("package-lock.json")).toBe(true);
    expect(isIgnoredFile("App.tsx")).toBe(false);
    expect(isIgnoredFile("package.json")).toBe(false);
  });

  it("exposes customizable ignore sets", () => {
    expect(DEFAULT_IGNORED_DIRS.has("node_modules")).toBe(true);
    expect(DEFAULT_IGNORED_FILES.has(".env")).toBe(true);
  });

  it("parses gitignore content and matches ignored directories and wildcards", () => {
    const gitignoreContent = `
      # Comments should be ignored
      temp/
      *.log
      /artifacts/
      build-output
      !important.log
    `;

    const matcher = parseGitignoreContent(gitignoreContent);
    expect(matcher.isIgnored("temp", true)).toBe(true);
    expect(matcher.isIgnored("sub/temp", true)).toBe(true);
    expect(matcher.isIgnored("app.log", false)).toBe(true);
    expect(matcher.isIgnored("logs/debug.log", false)).toBe(true);
    expect(matcher.isIgnored("artifacts", true)).toBe(true);
    expect(matcher.isIgnored("sub/artifacts", true)).toBe(false); // Rooted pattern
    expect(matcher.isIgnored("important.log", false)).toBe(false); // Negated pattern
    expect(matcher.isIgnored("src/main.ts", false)).toBe(false);
  });
});

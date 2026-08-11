import { describe, it, expect } from "vitest";
import {
  isIgnoredDirectory,
  isIgnoredFile,
  DEFAULT_IGNORED_DIRS,
  DEFAULT_IGNORED_FILES
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
});

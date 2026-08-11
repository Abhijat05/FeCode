import { describe, it, expect } from "vitest";
import * as path from "path";
import { resolveSafePath } from "./pathUtils.js";

describe("resolveSafePath", () => {
  const cwd = path.resolve("/project/root");

  it("resolves valid relative paths inside working directory", () => {
    const res = resolveSafePath(cwd, "src/App.tsx");
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.targetPath).toBe(path.resolve(cwd, "src/App.tsx"));
      expect(res.displayPath).toBe(path.normalize("src/App.tsx"));
    }
  });

  it("resolves valid absolute path inside working directory", () => {
    const validAbs = path.resolve(cwd, "package.json");
    const res = resolveSafePath(cwd, validAbs);
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.targetPath).toBe(validAbs);
    }
  });

  it("defaults to cwd when requested path is omitted or empty", () => {
    const res = resolveSafePath(cwd);
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.targetPath).toBe(cwd);
      expect(res.displayPath).toBe(".");
    }
  });

  it("rejects relative path traversal outside working directory", () => {
    const res = resolveSafePath(cwd, "../../secret.txt");
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.error.code).toBe("PATH_OUT_OF_BOUNDS");
      expect(res.error.message).toContain("traversal outside project root");
    }
  });

  it("rejects absolute path outside working directory", () => {
    const outsideAbs = path.resolve("/other/directory/file.txt");
    const res = resolveSafePath(cwd, outsideAbs);
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.error.code).toBe("PATH_OUT_OF_BOUNDS");
    }
  });
});

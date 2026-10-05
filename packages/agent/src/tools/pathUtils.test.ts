import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

  it("allows valid files starting with double-dots inside working directory", () => {
    const res = resolveSafePath(cwd, "..config.json");
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.targetPath).toBe(path.resolve(cwd, "..config.json"));
      expect(res.displayPath).toBe(path.normalize("..config.json"));
    }
  });

  describe("filesystem symlink and junction security checks", () => {
    let tmpBase: string;
    let workspaceDir: string;
    let outsideDir: string;
    let symlinkCreated = false;

    beforeEach(async () => {
      const fsSync = await import("fs");
      const os = await import("os");
      tmpBase = fsSync.mkdtempSync(path.join(os.tmpdir(), "fecode-path-test-"));
      workspaceDir = path.join(tmpBase, "workspace");
      outsideDir = path.join(tmpBase, "outside");
      fsSync.mkdirSync(workspaceDir, { recursive: true });
      fsSync.mkdirSync(outsideDir, { recursive: true });
      fsSync.writeFileSync(path.join(outsideDir, "secret.txt"), "super-secret");

      // Internal directory inside workspace
      const insideDir = path.join(workspaceDir, "inside");
      fsSync.mkdirSync(insideDir, { recursive: true });
      fsSync.writeFileSync(path.join(insideDir, "safe.txt"), "safe-content");

      try {
        // Create symlink pointing outside workspace
        fsSync.symlinkSync(
          outsideDir,
          path.join(workspaceDir, "link_to_outside"),
          process.platform === "win32" ? "junction" : "dir"
        );
        // Create symlink pointing inside workspace
        fsSync.symlinkSync(
          insideDir,
          path.join(workspaceDir, "link_to_inside"),
          process.platform === "win32" ? "junction" : "dir"
        );
        symlinkCreated = true;
      } catch {
        // In environments without symlink/junction permissions (e.g. Windows without Developer Mode),
        // symlink creation may fail.
        symlinkCreated = false;
      }
    });

    afterEach(async () => {
      const fsSync = await import("fs");
      try {
        fsSync.rmSync(tmpBase, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    });

    it("rejects access to existing files through a symlink pointing outside the workspace", () => {
      if (!symlinkCreated) return;
      const res = resolveSafePath(workspaceDir, "link_to_outside/secret.txt");
      expect("error" in res).toBe(true);
      if ("error" in res) {
        expect(res.error.code).toBe("PATH_OUT_OF_BOUNDS");
        expect(res.error.message).toContain("traversal outside project root");
      }
    });

    it("rejects access to new/non-existent files inside a symlinked external directory", () => {
      if (!symlinkCreated) return;
      const res = resolveSafePath(workspaceDir, "link_to_outside/new_leak.txt");
      expect("error" in res).toBe(true);
      if ("error" in res) {
        expect(res.error.code).toBe("PATH_OUT_OF_BOUNDS");
      }
    });

    it("allows access to files through a safe symlink pointing inside the workspace", () => {
      if (!symlinkCreated) return;
      const res = resolveSafePath(workspaceDir, "link_to_inside/safe.txt");
      expect("error" in res).toBe(false);
    });

    it("rejects Windows NTFS Alternate Data Streams", () => {
      const res = resolveSafePath(workspaceDir, "file.txt:hidden_stream");
      expect("error" in res).toBe(true);
      if ("error" in res) {
        expect(res.error.code).toBe("PATH_OUT_OF_BOUNDS");
      }
    });

    it("rejects Windows reserved DOS device names", () => {
      if (process.platform === "win32") {
        const res1 = resolveSafePath(workspaceDir, "NUL");
        expect("error" in res1).toBe(true);
        const res2 = resolveSafePath(workspaceDir, "com1.txt");
        expect("error" in res2).toBe(true);
      }
    });
  });
});


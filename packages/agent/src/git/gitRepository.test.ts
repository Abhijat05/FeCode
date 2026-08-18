import { describe, it, expect } from "vitest";
import { DefaultGitRepository, type GitCommandRunner } from "./gitRepository.js";

describe("DefaultGitRepository — Phase 5F", () => {
  it("detects Git repository correctly", async () => {
    const mockRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 1 };
    };

    const repo = new DefaultGitRepository(mockRunner);
    const isRepo = await repo.isRepository("/test");
    expect(isRepo).toBe(true);
  });

  it("handles non-Git directories gracefully", async () => {
    const mockRunner: GitCommandRunner = async () => {
      return { stdout: "", stderr: "fatal: not a git repository", exitCode: 128 };
    };

    const repo = new DefaultGitRepository(mockRunner);
    const isRepo = await repo.isRepository("/not-a-repo");
    expect(isRepo).toBe(false);

    const status = await repo.getStatus("/not-a-repo");
    expect(status.isRepository).toBe(false);
    expect(status.root).toBeNull();
    expect(status.branch).toBeNull();
    expect(status.files).toEqual([]);
  });

  it("resolves repository root and branch", async () => {
    const mockRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { stdout: "D:/projects/shop\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return { stdout: "feature/auth\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "status") {
        return {
          stdout: "## feature/auth\n M src/App.tsx\n",
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const repo = new DefaultGitRepository(mockRunner);
    const root = await repo.getRoot("/test");
    expect(root).toBe("D:/projects/shop");

    const branch = await repo.getBranch("/test");
    expect(branch).toBe("feature/auth");

    const status = await repo.getStatus("/test");
    expect(status.isRepository).toBe(true);
    expect(status.root).toBe("D:/projects/shop");
    expect(status.branch).toBe("feature/auth");
    expect(status.files.length).toBe(1);
  });
});

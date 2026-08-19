import { describe, it, expect } from "vitest";
import { performRecoverySafetyCheck } from "./safety.js";
import type { Checkpoint } from "../checkpoints/types.js";
import { DefaultGitRepository, type GitCommandRunner } from "../git/gitRepository.js";

describe("RecoverySafetyCheck — Phase 5H", () => {
  const validCheckpoint: Checkpoint = {
    id: "checkpoint-test-1",
    createdAt: new Date().toISOString(),
    repositoryRoot: "/repo",
    branch: "feature/auth",
    files: [
      { path: "src/App.tsx", status: "modified" },
      { path: "src/theme.ts", status: "modified" }
    ],
    totalFiles: 2,
    status: "ready",
    isGit: true
  };

  it("permits recovery when repository and branch match and changes are safe", async () => {
    const mockRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { stdout: "/repo\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return { stdout: "feature/auth\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "status") {
        return {
          stdout: "## feature/auth\n M src/App.tsx\n M src/Login.tsx\n?? src/auth.ts\n",
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const gitRepo = new DefaultGitRepository(mockRunner);
    const safety = await performRecoverySafetyCheck(validCheckpoint, "/repo", gitRepo);

    expect(safety.safe).toBe(true);
    expect(safety.conflicts).toEqual([]);
    expect(safety.reasons).toEqual([]);
    expect(safety.affectedFiles).toEqual(["src/Login.tsx", "src/auth.ts"]);
    expect(safety.preservedFiles).toEqual(["src/App.tsx", "src/theme.ts"]);
  });

  it("blocks recovery when branch differs from checkpoint branch", async () => {
    const mockRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { stdout: "/repo\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return { stdout: "feature/payment\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "status") {
        return { stdout: "## feature/payment\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const gitRepo = new DefaultGitRepository(mockRunner);
    const safety = await performRecoverySafetyCheck(validCheckpoint, "/repo", gitRepo);

    expect(safety.safe).toBe(false);
    expect(safety.reasons).toContain("Checkpoint branch differs from current branch");
  });

  it("blocks recovery when repository root differs from checkpoint root", async () => {
    const mockRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { stdout: "/other-repo\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return { stdout: "feature/auth\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const gitRepo = new DefaultGitRepository(mockRunner);
    const safety = await performRecoverySafetyCheck(validCheckpoint, "/other-repo", gitRepo);

    expect(safety.safe).toBe(false);
    expect(safety.reasons).toContain("Checkpoint repository mismatch");
  });

  it("blocks recovery when repository contains merge conflicts", async () => {
    const mockRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { stdout: "/repo\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return { stdout: "feature/auth\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "status") {
        return {
          stdout: "## feature/auth\nUU src/Conflict.tsx\n",
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const gitRepo = new DefaultGitRepository(mockRunner);
    const safety = await performRecoverySafetyCheck(validCheckpoint, "/repo", gitRepo);

    expect(safety.safe).toBe(false);
    expect(safety.reasons).toContain("Repository contains merge conflicts");
  });

  it("blocks recovery when protected files are affected", async () => {
    const mockRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { stdout: "/repo\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return { stdout: "feature/auth\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "status") {
        return {
          stdout: "## feature/auth\n M .env\n?? secrets.key\n",
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const gitRepo = new DefaultGitRepository(mockRunner);
    const safety = await performRecoverySafetyCheck(validCheckpoint, "/repo", gitRepo);

    expect(safety.safe).toBe(false);
    expect(safety.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(safety.conflicts.some((c) => c.path === ".env")).toBe(true);
  });
});

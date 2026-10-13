import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
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

  it("handles initial commits and unborn HEAD gracefully", async () => {
    const mockRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { stdout: "D:/projects/newrepo\n", stderr: "", exitCode: 0 };
      }
      // branch --show-current fails or returns empty on older git for unborn head
      if (args[0] === "branch" && args[1] === "--show-current") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      // symbolic-ref returns default branch
      if (args[0] === "symbolic-ref" && args[1] === "--short" && args[2] === "HEAD") {
        return { stdout: "main\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "status") {
        return {
          stdout: "## No commits yet on main\n?? index.ts\n",
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const repo = new DefaultGitRepository(mockRunner);
    const branch = await repo.getBranch("/test");
    expect(branch).toBe("main");

    const status = await repo.getStatus("/test");
    expect(status.isRepository).toBe(true);
    expect(status.branch).toBe("main");
    expect(status.files.length).toBe(1);
  });

  it("defaultRunner recovers from stale index.lock by clearing lock and retrying", async () => {
    const tmpGitDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-git-recovery-"));
    const dotGit = path.join(tmpGitDir, ".git");
    await fs.mkdir(dotGit);
    const lockFile = path.join(dotGit, "index.lock");
    await fs.writeFile(lockFile, "abandoned lock");
    const oldTime = (Date.now() - 10000) / 1000;
    await fs.utimes(lockFile, oldTime, oldTime);

    const origRun = DefaultGitRepository.runSingleGitProcess;
    let callCount = 0;
    try {
      DefaultGitRepository.runSingleGitProcess = async () => {
        callCount++;
        if (callCount === 1) {
          return {
            stdout: "",
            stderr: "fatal: Unable to create '.git/index.lock': File exists.",
            exitCode: 128
          };
        }
        return { stdout: "success", stderr: "", exitCode: 0 };
      };

      const res = await DefaultGitRepository.defaultRunner(["status"], tmpGitDir);
      expect(callCount).toBe(2);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toBe("success");

      const lockStillExists = await fs.stat(lockFile).then(() => true).catch(() => false);
      expect(lockStillExists).toBe(false);
    } finally {
      DefaultGitRepository.runSingleGitProcess = origRun;
      await fs.rm(tmpGitDir, { recursive: true, force: true });
    }
  });
});

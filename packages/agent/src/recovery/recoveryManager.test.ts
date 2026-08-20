import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultRecoveryManager } from "./recoveryManager.js";
import { DefaultCheckpointStore } from "../checkpoints/checkpointStore.js";
import { DefaultGitRepository, type GitCommandRunner } from "../git/gitRepository.js";
import type { Checkpoint } from "../checkpoints/types.js";

describe("DefaultRecoveryManager — Phase 5H", () => {
  let tmpWorkDir: string;
  let tmpStoreDir: string;

  beforeEach(async () => {
    tmpWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-rec-work-"));
    tmpStoreDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-rec-store-"));
    await fs.mkdir(path.join(tmpWorkDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpWorkDir, "src", "App.tsx"),
      "pre-existing content\n",
      "utf-8"
    );
    await fs.writeFile(
      path.join(tmpWorkDir, "src", "Login.tsx"),
      "fecode modified\n",
      "utf-8"
    );
    await fs.writeFile(
      path.join(tmpWorkDir, "src", "NewFile.ts"),
      "fecode added\n",
      "utf-8"
    );
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkDir, { recursive: true, force: true });
      await fs.rm(tmpStoreDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("generates preview distinguishing pre-existing and affected changes", async () => {
    const store = new DefaultCheckpointStore(tmpStoreDir);
    const cp: Checkpoint = {
      id: "checkpoint-test-1",
      createdAt: new Date().toISOString(),
      repositoryRoot: tmpWorkDir.replace(/\\/g, "/"),
      branch: "feature/auth",
      files: [
        { path: "src/App.tsx", status: "modified" },
        { path: "src/Login.tsx", status: "clean" }
      ],
      totalFiles: 2,
      status: "ready",
      isGit: true
    };
    await store.save(cp);

    const mockRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { stdout: `${tmpWorkDir.replace(/\\/g, "/")}\n`, stderr: "", exitCode: 0 };
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return { stdout: "feature/auth\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "status") {
        return {
          stdout: "## feature/auth\n M src/App.tsx\n M src/Login.tsx\n?? src/NewFile.ts\n",
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const gitRepo = new DefaultGitRepository(mockRunner);
    const manager = new DefaultRecoveryManager(store, gitRepo, mockRunner);

    const preview = await manager.preview("checkpoint-test-1", tmpWorkDir);

    expect(preview.safe).toBe(true);
    expect(preview.checkpointId).toBe("checkpoint-test-1");
    expect(preview.currentBranch).toBe("feature/auth");
    expect(preview.totalFiles).toBe(2);
    expect(preview.files.map((f) => f.path)).toEqual([
      "src/Login.tsx",
      "src/NewFile.ts"
    ]);
    expect(preview.preExistingFiles).toEqual(["src/App.tsx"]);
  });

  it("recovers safely with explicit approval, deleting newly created files and restoring modified files", async () => {
    const store = new DefaultCheckpointStore(tmpStoreDir);
    const cp: Checkpoint = {
      id: "checkpoint-test-2",
      createdAt: new Date().toISOString(),
      repositoryRoot: tmpWorkDir.replace(/\\/g, "/"),
      branch: "feature/auth",
      files: [
        { path: "src/App.tsx", status: "modified" },
        { path: "src/Login.tsx", status: "clean" }
      ],
      totalFiles: 2,
      status: "ready",
      isGit: true
    };
    await store.save(cp);

    const checkedOutFiles: string[] = [];
    const mockRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { stdout: `${tmpWorkDir.replace(/\\/g, "/")}\n`, stderr: "", exitCode: 0 };
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return { stdout: "feature/auth\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "checkout") {
        checkedOutFiles.push(args[3]);
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (args[0] === "status") {
        return {
          stdout: "## feature/auth\n M src/App.tsx\n M src/Login.tsx\n?? src/NewFile.ts\n",
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const gitRepo = new DefaultGitRepository(mockRunner);
    const manager = new DefaultRecoveryManager(store, gitRepo, mockRunner);

    const result = await manager.recover("checkpoint-test-2", {
      cwd: tmpWorkDir,
      approved: true
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.recoveredFiles).toEqual(["src/Login.tsx", "src/NewFile.ts"]);
    expect(result.preservedFiles).toEqual(["src/App.tsx"]);

    // Untracked new file should be deleted
    await expect(fs.stat(path.join(tmpWorkDir, "src", "NewFile.ts"))).rejects.toThrow();

    // Tracked modified file was checked out
    expect(checkedOutFiles).toContain("src/Login.tsx");
    // Pre-existing modified file was NOT checked out
    expect(checkedOutFiles).not.toContain("src/App.tsx");
  });

  it("refuses recovery when approval is not granted", async () => {
    const store = new DefaultCheckpointStore(tmpStoreDir);
    const cp: Checkpoint = {
      id: "checkpoint-test-3",
      createdAt: new Date().toISOString(),
      repositoryRoot: tmpWorkDir.replace(/\\/g, "/"),
      branch: "feature/auth",
      files: [],
      totalFiles: 0,
      status: "ready",
      isGit: true
    };
    await store.save(cp);

    const mockRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { stdout: `${tmpWorkDir.replace(/\\/g, "/")}\n`, stderr: "", exitCode: 0 };
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return { stdout: "feature/auth\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "status") {
        return { stdout: "## feature/auth\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const gitRepo = new DefaultGitRepository(mockRunner);
    const manager = new DefaultRecoveryManager(store, gitRepo, mockRunner);

    const result = await manager.recover("checkpoint-test-3", {
      cwd: tmpWorkDir,
      approved: false
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.error).toContain("requires explicit user approval");
  });

  it("handles cancellation via AbortSignal", async () => {
    const store = new DefaultCheckpointStore(tmpStoreDir);
    const manager = new DefaultRecoveryManager(store);

    const controller = new AbortController();
    controller.abort();

    const result = await manager.recover("checkpoint-test-4", {
      cwd: tmpWorkDir,
      signal: controller.signal
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("cancelled");
  });

  it("blocks recovery for discarded checkpoints", async () => {
    const store = new DefaultCheckpointStore(tmpStoreDir);
    const cp: Checkpoint = {
      id: "checkpoint-discarded-1",
      createdAt: new Date().toISOString(),
      repositoryRoot: tmpWorkDir.replace(/\\/g, "/"),
      branch: "feature/auth",
      files: [],
      totalFiles: 0,
      status: "discarded",
      isGit: true
    };
    await store.save(cp);

    const manager = new DefaultRecoveryManager(store);
    const preview = await manager.preview("checkpoint-discarded-1", tmpWorkDir);
    expect(preview.safe).toBe(false);
    expect(preview.reasons).toContain("Checkpoint has been discarded");

    const result = await manager.recover("checkpoint-discarded-1", {
      cwd: tmpWorkDir,
      approved: true
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe("blocked");
  });

  it("updates checkpoint status to restored upon successful recovery", async () => {
    const store = new DefaultCheckpointStore(tmpStoreDir);
    const cp: Checkpoint = {
      id: "checkpoint-test-lifecycle",
      createdAt: new Date().toISOString(),
      repositoryRoot: tmpWorkDir.replace(/\\/g, "/"),
      branch: "feature/auth",
      files: [],
      totalFiles: 0,
      status: "created",
      isGit: true
    };
    await store.save(cp);

    const mockRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { stdout: `${tmpWorkDir.replace(/\\/g, "/")}\n`, stderr: "", exitCode: 0 };
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return { stdout: "feature/auth\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "status") {
        return { stdout: "## feature/auth\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const gitRepo = new DefaultGitRepository(mockRunner);
    const manager = new DefaultRecoveryManager(store, gitRepo, mockRunner);

    const result = await manager.recover("checkpoint-test-lifecycle", {
      cwd: tmpWorkDir,
      approved: true
    });

    expect(result.success).toBe(true);
    const updatedCp = await store.get("checkpoint-test-lifecycle");
    expect(updatedCp?.status).toBe("restored");
  });
});

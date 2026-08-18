import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultCheckpointManager } from "./checkpointManager.js";
import { DefaultCheckpointStore } from "./checkpointStore.js";
import { DefaultGitRepository, type GitCommandRunner } from "../git/gitRepository.js";

describe("DefaultCheckpointManager — Phase 5G", () => {
  let tmpDir: string;
  let storeDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-cpmgr-test-"));
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-cpmgr-store-"));
    await fs.writeFile(path.join(tmpDir, "index.ts"), "console.log(1);\n", "utf-8");
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("creates and inspects a checkpoint for a Git repository without mutating working tree", async () => {
    const mockRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { stdout: `${tmpDir.replace(/\\/g, "/")}\n`, stderr: "", exitCode: 0 };
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return { stdout: "feature/auth\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "status") {
        return {
          stdout: "## feature/auth\n M src/App.tsx\n?? notes.txt\n",
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const gitRepo = new DefaultGitRepository(mockRunner);
    const store = new DefaultCheckpointStore(storeDir);
    const manager = new DefaultCheckpointManager(store, gitRepo);

    const res = await manager.create({ cwd: tmpDir, reason: "Multi-file refactor" });
    expect(res.success).toBe(true);
    expect(res.checkpoint).toBeDefined();
    expect(res.checkpoint?.isGit).toBe(true);
    expect(res.checkpoint?.branch).toBe("feature/auth");
    expect(res.checkpoint?.totalFiles).toBe(2);

    const inspected = await manager.inspect(res.checkpoint!.id);
    expect(inspected).not.toBeNull();
    expect(inspected?.id).toBe(res.checkpoint!.id);
    expect(inspected?.status).toBe("ready");
  });

  it("handles non-Git repositories gracefully", async () => {
    const mockRunner: GitCommandRunner = async () => {
      return { stdout: "", stderr: "fatal: not a git repo", exitCode: 128 };
    };

    const gitRepo = new DefaultGitRepository(mockRunner);
    const store = new DefaultCheckpointStore(storeDir);
    const manager = new DefaultCheckpointManager(store, gitRepo);

    const res = await manager.create({ cwd: tmpDir, reason: "Non-git changes" });
    expect(res.success).toBe(true);
    expect(res.checkpoint?.isGit).toBe(false);
    expect(res.checkpoint?.branch).toBeNull();
    expect(res.checkpoint?.totalFiles).toBeGreaterThanOrEqual(1);
  });

  it("handles cancellation via AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();

    const store = new DefaultCheckpointStore(storeDir);
    const manager = new DefaultCheckpointManager(store);

    const res = await manager.create({
      cwd: tmpDir,
      signal: controller.signal
    });

    expect(res.success).toBe(false);
    expect(res.code).toBe("ABORTED");
  });

  it("compares working directory state against a checkpoint", async () => {
    const mockRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "status") {
        return {
          stdout: "## main\n M src/components/Login.tsx\n?? src/auth/session.ts\n",
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const gitRepo = new DefaultGitRepository(mockRunner);
    const store = new DefaultCheckpointStore(storeDir);
    const manager = new DefaultCheckpointManager(store, gitRepo);

    const createRes = await manager.create({ cwd: tmpDir });
    expect(createRes.success).toBe(true);

    const comparison = await manager.compare(createRes.checkpoint!.id, tmpDir);
    expect(comparison.checkpointId).toBe(createRes.checkpoint!.id);
    expect(comparison.files.length).toBe(2);
    expect(comparison.files[0].path).toBe("src/auth/session.ts");
    expect(comparison.files[0].operation).toBe("added");
    expect(comparison.files[1].path).toBe("src/components/Login.tsx");
    expect(comparison.files[1].operation).toBe("modified");
  });
});

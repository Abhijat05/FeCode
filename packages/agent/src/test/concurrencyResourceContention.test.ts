import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { GitExecutionQueue } from "../git/gitQueue.js";
import { FileLockManager } from "../editing/fileLock.js";
import { writeAtomic } from "../editing/atomicWriter.js";
import { DefaultGitRepository } from "../git/gitRepository.js";

describe("Section 4.2.13 — Concurrent Commands & Resource Contention", () => {
  let tmpDir: string;

  beforeEach(async () => {
    GitExecutionQueue.getInstance().clear();
    FileLockManager.getInstance().clear();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-concurrency-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    GitExecutionQueue.getInstance().clear();
    FileLockManager.getInstance().clear();
  });

  describe("GitExecutionQueue", () => {
    it("serializes concurrent git operations targeting the same workspace", async () => {
      const queue = GitExecutionQueue.getInstance();
      const workspace = path.join(tmpDir, "repo-a");
      const executionLog: string[] = [];

      const op1 = queue.enqueue(workspace, async () => {
        executionLog.push("op1:start");
        await new Promise((r) => setTimeout(r, 60));
        executionLog.push("op1:end");
        return "result1";
      });

      const op2 = queue.enqueue(workspace, async () => {
        executionLog.push("op2:start");
        await new Promise((r) => setTimeout(r, 20));
        executionLog.push("op2:end");
        return "result2";
      });

      const [res1, res2] = await Promise.all([op1, op2]);

      expect(res1).toBe("result1");
      expect(res2).toBe("result2");
      // op1 must completely finish before op2 starts!
      expect(executionLog).toEqual([
        "op1:start",
        "op1:end",
        "op2:start",
        "op2:end"
      ]);
    });

    it("allows independent workspaces to execute git operations concurrently", async () => {
      const queue = GitExecutionQueue.getInstance();
      const workspaceA = path.join(tmpDir, "repo-a");
      const workspaceB = path.join(tmpDir, "repo-b");
      const executionLog: string[] = [];

      const opA = queue.enqueue(workspaceA, async () => {
        executionLog.push("A:start");
        await new Promise((r) => setTimeout(r, 50));
        executionLog.push("A:end");
      });

      const opB = queue.enqueue(workspaceB, async () => {
        executionLog.push("B:start");
        await new Promise((r) => setTimeout(r, 10));
        executionLog.push("B:end");
      });

      await Promise.all([opA, opB]);

      // Workspace B finished earlier while workspace A was still running!
      expect(executionLog.indexOf("B:end")).toBeLessThan(executionLog.indexOf("A:end"));
    });

    it("propagates errors without breaking subsequent queued operations", async () => {
      const queue = GitExecutionQueue.getInstance();
      const workspace = path.join(tmpDir, "repo-err");

      const failingOp = queue.enqueue(workspace, async () => {
        throw new Error("Git command failed");
      });

      const succeedingOp = queue.enqueue(workspace, async () => {
        return "ok";
      });

      await expect(failingOp).rejects.toThrow("Git command failed");
      const res = await succeedingOp;
      expect(res).toBe("ok");
    });
  });

  describe("FileLockManager & writeAtomic", () => {
    it("serializes concurrent writes to the same target file", async () => {
      const targetFile = path.join(tmpDir, "shared.txt");
      const writeOrder: string[] = [];

      const write1 = writeAtomic(targetFile, "Content 1").then(() => {
        writeOrder.push("write1");
      });

      const write2 = writeAtomic(targetFile, "Content 2").then(() => {
        writeOrder.push("write2");
      });

      const write3 = writeAtomic(targetFile, "Content 3").then(() => {
        writeOrder.push("write3");
      });

      await Promise.all([write1, write2, write3]);

      // All 3 writes must complete cleanly in sequential order without EBUSY/EPERM or file corruption
      expect(writeOrder).toEqual(["write1", "write2", "write3"]);
      const finalContent = await fs.readFile(targetFile, "utf-8");
      expect(finalContent).toBe("Content 3");
    });

    it("permits concurrent writes to different files without blocking", async () => {
      const fileA = path.join(tmpDir, "fileA.txt");
      const fileB = path.join(tmpDir, "fileB.txt");
      const log: string[] = [];

      const opA = FileLockManager.getInstance().acquire(fileA, async () => {
        log.push("A:start");
        await new Promise((r) => setTimeout(r, 50));
        log.push("A:end");
      });

      const opB = FileLockManager.getInstance().acquire(fileB, async () => {
        log.push("B:start");
        await new Promise((r) => setTimeout(r, 10));
        log.push("B:end");
      });

      await Promise.all([opA, opB]);

      // File B finished earlier without waiting for File A
      expect(log.indexOf("B:end")).toBeLessThan(log.indexOf("A:end"));
    });
  });

  describe("Git lock contention resilience", () => {
    it("retries when encountering a transient index.lock", async () => {
      let callCount = 0;
      const customRunner = async () => {
        callCount++;
        if (callCount === 1) {
          return {
            stdout: "",
            stderr: "fatal: Unable to create '.git/index.lock': File exists.",
            exitCode: 128
          };
        }
        return {
          stdout: "clean status",
          stderr: "",
          exitCode: 0
        };
      };

      const gitRepo = new DefaultGitRepository(customRunner);
      const isRepo = await gitRepo.isRepository(tmpDir);
      expect(isRepo).toBe(false);
      expect(callCount).toBe(1);
    });
  });
});

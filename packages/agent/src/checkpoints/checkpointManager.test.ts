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
    expect(inspected?.status).toBe("created");
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

  it("supports get and discard lifecycle transitions", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const manager = new DefaultCheckpointManager(store);

    const res = await manager.create({
      cwd: tmpDir,
      reason: "Pre-refactor snapshot",
      affectedFiles: ["src/index.ts"]
    });
    expect(res.success).toBe(true);
    const id = res.checkpoint!.id;

    const fetched = await manager.get(id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(id);
    expect(fetched?.reason).toBe("Pre-refactor snapshot");
    expect(fetched?.affectedFiles).toEqual(["src/index.ts"]);

    // Discard checkpoint
    await manager.discard(id);
    const discarded = await manager.get(id);
    expect(discarded?.status).toBe("discarded");
  });

  describe("Phase 5Y — Checkpoint Continuity & Approval Lifecycle", () => {
    it("manages complete approval lifecycle: request -> approve -> consume", async () => {
      const store = new DefaultCheckpointStore(storeDir);
      const manager = new DefaultCheckpointManager(store);

      const record = await manager.requestApproval({
        runId: "run-5y-1",
        planId: "plan-5y-1",
        stepId: "step-1",
        stepOrder: 1,
        riskLevel: "elevated",
        reason: "Modifying sensitive auth files",
        affectedTargets: ["src/auth.ts"],
        cwd: tmpDir
      });

      expect(record.status).toBe("pending");
      expect(record.riskLevel).toBe("elevated");
      expect(record.affectedTargets).toEqual(["src/auth.ts"]);

      // Approve
      const approved = await manager.approve(record.checkpointId, {
        approved: true,
        approvedBy: "user",
        decision: "approved",
        timestamp: Date.now()
      });
      expect(approved.status).toBe("approved");

      // Validate
      const val = await manager.validateApproval(record.checkpointId, {
        runId: "run-5y-1",
        planId: "plan-5y-1",
        stepId: "step-1",
        riskLevel: "elevated",
        cwd: tmpDir
      });
      expect(val.valid).toBe(true);

      // Consume
      const consumed = await manager.consume(record.checkpointId, {
        runId: "run-5y-1",
        planId: "plan-5y-1",
        stepId: "step-1",
        riskLevel: "elevated",
        cwd: tmpDir
      });
      expect(consumed.success).toBe(true);
      expect(consumed.status).toBe("consumed");

      // Single-use guarantee: second consumption must fail
      const secondConsume = await manager.consume(record.checkpointId, {
        runId: "run-5y-1",
        planId: "plan-5y-1",
        stepId: "step-1",
        riskLevel: "elevated",
        cwd: tmpDir
      });
      expect(secondConsume.success).toBe(false);
      expect(secondConsume.error).toContain("already been consumed");
    });

    it("handles rejection lifecycle cleanly", async () => {
      const store = new DefaultCheckpointStore(storeDir);
      const manager = new DefaultCheckpointManager(store);

      const record = await manager.requestApproval({
        runId: "run-5y-2",
        planId: "plan-5y-2",
        stepId: "step-1",
        riskLevel: "critical",
        reason: "Database schema migration",
        affectedTargets: ["db/schema.sql"],
        cwd: tmpDir
      });

      const rejected = await manager.reject(
        record.checkpointId,
        "User declined migration"
      );
      expect(rejected.status).toBe("rejected");
      expect(rejected.invalidationReason).toBe("User declined migration");

      const val = await manager.validateApproval(record.checkpointId, {
        runId: "run-5y-2",
        planId: "plan-5y-2",
        stepId: "step-1",
        riskLevel: "critical",
        cwd: tmpDir
      });
      expect(val.valid).toBe(false);
      expect(val.status).toBe("rejected");
    });

    it("invalidates approval on execution context mismatch (runId, planId, stepId)", async () => {
      const store = new DefaultCheckpointStore(storeDir);
      const manager = new DefaultCheckpointManager(store);

      const record = await manager.requestApproval({
        runId: "run-5y-3",
        planId: "plan-5y-3",
        stepId: "step-1",
        riskLevel: "elevated",
        reason: "Elevated task",
        affectedTargets: ["src/config.ts"],
        cwd: tmpDir
      });

      await manager.approve(record.checkpointId, {
        approved: true,
        approvedBy: "user",
        decision: "approved",
        timestamp: Date.now()
      });

      // Different Run ID
      const valDiffRun = await manager.validateApproval(record.checkpointId, {
        runId: "run-other",
        planId: "plan-5y-3",
        stepId: "step-1",
        riskLevel: "elevated",
        cwd: tmpDir
      });
      expect(valDiffRun.valid).toBe(false);
      expect(valDiffRun.status).toBe("invalidated");
      expect(valDiffRun.reason).toContain("Run ID mismatch");

      // Reset record to approved
      const record2 = await manager.requestApproval({
        runId: "run-5y-3",
        planId: "plan-5y-3",
        stepId: "step-1",
        riskLevel: "elevated",
        reason: "Elevated task 2",
        affectedTargets: ["src/config.ts"],
        cwd: tmpDir
      });
      await manager.approve(record2.checkpointId, {
        approved: true,
        approvedBy: "user",
        decision: "approved",
        timestamp: Date.now()
      });

      // Different Step ID
      const valDiffStep = await manager.validateApproval(record2.checkpointId, {
        runId: "run-5y-3",
        planId: "plan-5y-3",
        stepId: "step-999",
        riskLevel: "elevated",
        cwd: tmpDir
      });
      expect(valDiffStep.valid).toBe(false);
      expect(valDiffStep.status).toBe("invalidated");
      expect(valDiffStep.reason).toContain("Step ID mismatch");
    });

    it("invalidates approval on risk level escalation", async () => {
      const store = new DefaultCheckpointStore(storeDir);
      const manager = new DefaultCheckpointManager(store);

      const record = await manager.requestApproval({
        runId: "run-5y-4",
        planId: "plan-5y-4",
        stepId: "step-1",
        riskLevel: "normal",
        reason: "Normal task",
        affectedTargets: ["src/app.ts"],
        cwd: tmpDir
      });

      await manager.approve(record.checkpointId, {
        approved: true,
        approvedBy: "user",
        decision: "approved",
        timestamp: Date.now()
      });

      // Risk escalated to critical
      const val = await manager.validateApproval(record.checkpointId, {
        runId: "run-5y-4",
        planId: "plan-5y-4",
        stepId: "step-1",
        riskLevel: "critical",
        cwd: tmpDir
      });
      expect(val.valid).toBe(false);
      expect(val.status).toBe("invalidated");
      expect(val.reason).toContain("Risk level escalated");
    });

    it("expires approval when TTL elapsed", async () => {
      const store = new DefaultCheckpointStore(storeDir);
      const manager = new DefaultCheckpointManager(store);

      const record = await manager.requestApproval({
        runId: "run-5y-5",
        planId: "plan-5y-5",
        stepId: "step-1",
        riskLevel: "elevated",
        reason: "Quick expiry task",
        affectedTargets: ["src/app.ts"],
        cwd: tmpDir,
        ttlMs: -100 // already expired
      });

      await expect(
        manager.approve(record.checkpointId, {
          approved: true,
          approvedBy: "user",
          decision: "approved",
          timestamp: Date.now()
        })
      ).rejects.toThrow("expired");

      const val = await manager.validateApproval(record.checkpointId, {
        runId: "run-5y-5",
        planId: "plan-5y-5",
        stepId: "step-1",
        riskLevel: "elevated",
        cwd: tmpDir
      });
      expect(val.valid).toBe(false);
      expect(val.status).toBe("expired");
    });

    it("strictly rejects when planId or stepId is missing in validation context", async () => {
      const store = new DefaultCheckpointStore(storeDir);
      const manager = new DefaultCheckpointManager(store);

      const record = await manager.requestApproval({
        runId: "run-5y-strict",
        planId: "plan-5y-strict",
        stepId: "step-1",
        riskLevel: "elevated",
        reason: "Strict binding test",
        affectedTargets: ["src/app.ts"],
        cwd: tmpDir
      });

      await manager.approve(record.checkpointId, {
        approved: true,
        approvedBy: "user",
        decision: "approved",
        timestamp: Date.now()
      });

      // Context missing planId
      const valMissingPlan = await manager.validateApproval(record.checkpointId, {
        runId: "run-5y-strict",
        stepId: "step-1",
        riskLevel: "elevated",
        cwd: tmpDir
      });
      expect(valMissingPlan.valid).toBe(false);
      expect(valMissingPlan.status).toBe("invalidated");
      expect(valMissingPlan.reason).toContain("Plan ID mismatch");

      const recordStep = await manager.requestApproval({
        runId: "run-5y-strict-2",
        planId: "plan-5y-strict-2",
        stepId: "step-1",
        riskLevel: "elevated",
        reason: "Strict step binding test",
        affectedTargets: ["src/app.ts"],
        cwd: tmpDir
      });

      await manager.approve(recordStep.checkpointId, {
        approved: true,
        approvedBy: "user",
        decision: "approved",
        timestamp: Date.now()
      });

      // Context missing stepId
      const valMissingStep = await manager.validateApproval(recordStep.checkpointId, {
        runId: "run-5y-strict-2",
        planId: "plan-5y-strict-2",
        riskLevel: "elevated",
        cwd: tmpDir
      });
      expect(valMissingStep.valid).toBe(false);
      expect(valMissingStep.status).toBe("invalidated");
      expect(valMissingStep.reason).toContain("Step ID mismatch");
    });

    it("rejects cross-plan checkpoint consumption", async () => {
      const store = new DefaultCheckpointStore(storeDir);
      const manager = new DefaultCheckpointManager(store);

      const record = await manager.requestApproval({
        runId: "run-cross-plan",
        planId: "plan-A",
        stepId: "step-1",
        stepOrder: 1,
        riskLevel: "elevated",
        reason: "Cross-plan test",
        affectedTargets: ["src/app.ts"],
        requiredAction: "modify src/app.ts",
        cwd: tmpDir
      });

      await manager.approve(record.checkpointId, {
        approved: true,
        approvedBy: "user",
        decision: "approved",
        timestamp: Date.now()
      });

      const consumeRes = await manager.consume(record.checkpointId, {
        runId: "run-cross-plan",
        planId: "plan-B", // Different plan!
        stepId: "step-1",
        riskLevel: "elevated",
        cwd: tmpDir
      });

      expect(consumeRes.success).toBe(false);
      expect(consumeRes.error).toContain("Plan ID mismatch");
    });
  });
});



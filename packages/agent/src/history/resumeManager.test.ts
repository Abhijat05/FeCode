import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultRunHistoryStore } from "./runHistoryStore.js";
import { DefaultResumeManager } from "./resumeManager.js";
import { DefaultTaskRiskPolicy } from "../policy/taskRiskPolicy.js";
import type { DurableRunRecord } from "./types.js";

describe("DefaultResumeManager — Phase 5N", () => {
  let tmpDir: string;
  let historyStore: DefaultRunHistoryStore;
  let resumeManager: DefaultResumeManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-resume-mgr-test-"));
    await fs.writeFile(path.join(tmpDir, "sample.ts"), "export const x = 1;\n", "utf-8");
    historyStore = new DefaultRunHistoryStore({ storageDir: tmpDir });
    resumeManager = new DefaultResumeManager({
      historyStore,
      executionPolicy: new DefaultTaskRiskPolicy()
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("prepares explicit resume for an interrupted run with new runId and parent linkage", async () => {
    const interruptedRun: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-orig-interrupted",
      projectId: "proj-test",
      cwd: tmpDir,
      userRequestSummary: "Refactor sample module",
      startedAt: Date.now() - 3600000,
      finalStatus: "interrupted",
      executionState: "interrupted",
      activeSkills: ["typescript"],
      initialRiskLevel: "normal",
      riskReasons: [],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 0,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [],
      commands: [],
      files: { modified: ["sample.ts"], created: [], deleted: [] },
      lifecycleTransitions: []
    };

    await historyStore.saveRun(interruptedRun);

    const prep = await resumeManager.prepareResume("run-orig-interrupted", tmpDir);
    expect(prep.canResume).toBe(true);
    expect(prep.suggestedParentRunId).toBe("run-orig-interrupted");
    expect(prep.newRunId).not.toBe("run-orig-interrupted");
    expect(prep.newRunId.startsWith("run-resume-")).toBe(true);
    expect(prep.reassessedRisk).toBeDefined();
  });

  it("prepares explicit resume for a failed run and captures previous failure context", async () => {
    const failedRun: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-orig-failed",
      projectId: "proj-test",
      cwd: tmpDir,
      userRequestSummary: "Fix unit test failure",
      startedAt: Date.now() - 10000,
      completedAt: Date.now(),
      finalStatus: "failed",
      executionState: "failed",
      activeSkills: [],
      initialRiskLevel: "normal",
      riskReasons: [],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 3,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [],
      commands: [
        {
          command: "npm test",
          attempt: 1,
          startedAt: Date.now() - 5000,
          succeeded: false,
          exitCode: 1
        }
      ],
      files: { modified: ["sample.ts"], created: [], deleted: [] },
      lifecycleTransitions: [],
      failureReason: "Verification failed after 3 attempts"
    };

    await historyStore.saveRun(failedRun);

    const prep = await resumeManager.prepareResume("run-orig-failed", tmpDir);
    expect(prep.canResume).toBe(true);
    expect(prep.explanation).toContain("Verification failed after 3 attempts");
  });

  it("rejects resume for completed runs", async () => {
    const completedRun: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-completed",
      projectId: "proj-test",
      cwd: tmpDir,
      userRequestSummary: "Build complete feature",
      startedAt: Date.now() - 10000,
      completedAt: Date.now(),
      finalStatus: "completed",
      executionState: "completed",
      activeSkills: [],
      initialRiskLevel: "normal",
      riskReasons: [],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 1,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [],
      commands: [],
      files: { modified: [], created: [], deleted: [] },
      lifecycleTransitions: []
    };

    await historyStore.saveRun(completedRun);

    const prep = await resumeManager.prepareResume("run-completed", tmpDir);
    expect(prep.canResume).toBe(false);
    expect(prep.explanation).toContain("cannot be resumed");
  });

  it("detects workspace modifications and flags required user confirmation", async () => {
    const trackedFilePath = "sample.ts";
    const run: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-workspace-test",
      projectId: "proj-test",
      cwd: tmpDir,
      userRequestSummary: "Edit sample.ts",
      startedAt: Date.now() - 5000,
      finalStatus: "interrupted",
      executionState: "interrupted",
      activeSkills: [],
      initialRiskLevel: "normal",
      riskReasons: [],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 0,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [],
      commands: [],
      files: { modified: [trackedFilePath], created: [], deleted: [] },
      lifecycleTransitions: [],
      workspaceFingerprint: {
        capturedAt: Date.now() - 5000,
        fileFingerprints: {
          [trackedFilePath]: {
            size: 21,
            mtimeMs: Date.now() - 10000
          }
        }
      }
    };

    await historyStore.saveRun(run);

    // Modify file on disk to simulate external workspace changes
    await fs.writeFile(
      path.join(tmpDir, "sample.ts"),
      "export const x = 1; // externally modified\n\n\n\n",
      "utf-8"
    );

    const prep = await resumeManager.prepareResume("run-workspace-test", tmpDir);
    expect(prep.canResume).toBe(true);
    expect(prep.workspaceChanged).toBe(true);
    expect(prep.requiresUserConfirmation).toBe(true);
    expect(prep.workspaceDiffReasons.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultExecutionRecoveryManager } from "./executionRecoveryManager.js";
import { DefaultTaskRiskPolicy } from "../policy/taskRiskPolicy.js";
import { createTaskPlan } from "./taskPlan.js";
import type {
  ExecutionRecoveryAssessment,
  FinalWorkspaceReconciler
} from "./types.js";
import type { AgentEvent } from "../index.js";

describe("Phase 5W — Recovery Outcome & Post-Recovery Reconciliation", () => {
  let tmpDir: string;
  let riskPolicy: DefaultTaskRiskPolicy;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-5w-test-"));
    riskPolicy = new DefaultTaskRiskPolicy();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("determines 'recovered' outcome when verification and reconciliation pass with exact state", async () => {
    const targetFile = "src/recovered_exact.ts";
    const mockReconciler: FinalWorkspaceReconciler = {
      async reconcile() {
        return {
          reconciliationId: "recon-exact-1",
          runId: "run-5w-1",
          planId: "plan-5w-1",
          status: "consistent",
          checkedAt: Date.now(),
          expectedFiles: [targetFile],
          modifiedFiles: [targetFile],
          unexpectedFiles: [],
          missingFiles: [],
          changedFiles: [],
          branchChanged: false,
          workspaceChanged: false,
          verificationPassed: true,
          consistent: true
        };
      }
    };

    const mockCmdExecutor = {
      async execute(cmd: string) {
        return {
          command: cmd,
          exitCode: 0,
          stdout: "All tests pass",
          stderr: "",
          timedOut: false,
          truncated: false
        };
      }
    };

    const recoveryManager = new DefaultExecutionRecoveryManager({
      executionPolicy: riskPolicy,
      reconciler: mockReconciler,
      commandExecutor: mockCmdExecutor
    });

    const plan = createTaskPlan({
      planId: "plan-5w-1",
      runId: "run-5w-1",
      userRequestSummary: "Create exact helper",
      objective: "Exact helper",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Create helper",
          objective: "File",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: true,
          status: "pending",
          expectedFiles: [targetFile],
          intent: {
            type: "create_file",
            target: targetFile,
            reason: "Create file",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    const assessment: ExecutionRecoveryAssessment = {
      eligible: true,
      strategy: "repair",
      riskLevel: "normal",
      riskReasons: [],
      workspaceDrift: false,
      affectedSteps: ["step-1"],
      affectedFiles: [targetFile],
      requiresExplicitApproval: true,
      reason: "Missing expected file",
      recoveryDepth: 0,
      maxRecoveryDepth: 5,
      isLimitReached: false,
      repairActions: [
        {
          target: targetFile,
          operation: "create_file",
          reason: "Repair missing file",
          content: "export const x = 1;\n"
        }
      ]
    };

    const events: AgentEvent[] = [];
    for await (const ev of recoveryManager.executeRecovery(plan, assessment, {
      cwd: tmpDir,
      approved: true
    })) {
      events.push(ev);
    }

    const outcomeEv = events.find((e) => e.type === "recovery_outcome_determined");
    expect(outcomeEv).toBeDefined();
    if (outcomeEv && outcomeEv.type === "recovery_outcome_determined") {
      expect(outcomeEv.outcome).toBe("recovered");
      expect(outcomeEv.result.status).toBe("completed");
      expect(outcomeEv.result.workspaceConsistent).toBe(true);
      expect(outcomeEv.result.completedRecoveryActions?.length).toBe(1);
      expect(outcomeEv.result.failedRecoveryActions?.length).toBe(0);
      expect(outcomeEv.result.verificationResult?.success).toBe(true);
    }

    const completedEv = events.find((e) => e.type === "recovery_completed");
    expect(completedEv).toBeDefined();
  });

  it("determines 'recovered_with_changes' outcome when workspace has accepted differences", async () => {
    const targetFile = "src/recovered_diff.ts";
    const mockReconciler: FinalWorkspaceReconciler = {
      async reconcile() {
        return {
          reconciliationId: "recon-diff-1",
          runId: "run-5w-2",
          planId: "plan-5w-2",
          status: "consistent",
          checkedAt: Date.now(),
          expectedFiles: [targetFile],
          modifiedFiles: [targetFile],
          unexpectedFiles: ["extra.log"],
          missingFiles: [],
          changedFiles: ["extra.log"],
          branchChanged: false,
          workspaceChanged: true,
          verificationPassed: true,
          consistent: true
        };
      }
    };

    const recoveryManager = new DefaultExecutionRecoveryManager({
      executionPolicy: riskPolicy,
      reconciler: mockReconciler
    });

    const plan = createTaskPlan({
      planId: "plan-5w-2",
      runId: "run-5w-2",
      userRequestSummary: "Create diff helper",
      objective: "Diff helper",
      steps: []
    });

    const assessment: ExecutionRecoveryAssessment = {
      eligible: true,
      strategy: "repair",
      riskLevel: "normal",
      riskReasons: [],
      workspaceDrift: false,
      affectedSteps: [],
      affectedFiles: [targetFile],
      requiresExplicitApproval: true,
      reason: "Repair file",
      recoveryDepth: 0,
      maxRecoveryDepth: 5,
      isLimitReached: false,
      repairActions: [
        {
          target: targetFile,
          operation: "create_file",
          reason: "Repair missing file",
          content: "export const diff = 2;\n"
        }
      ]
    };

    const events: AgentEvent[] = [];
    for await (const ev of recoveryManager.executeRecovery(plan, assessment, {
      cwd: tmpDir,
      approved: true
    })) {
      events.push(ev);
    }

    const outcomeEv = events.find((e) => e.type === "recovery_outcome_determined");
    expect(outcomeEv).toBeDefined();
    if (outcomeEv && outcomeEv.type === "recovery_outcome_determined") {
      expect(outcomeEv.outcome).toBe("recovered_with_changes");
      expect(outcomeEv.result.status).toBe("completed");
      expect(outcomeEv.result.workspaceConsistent).toBe(true);
    }
  });

  it("determines 'still_blocked' outcome and records blockers when verification fails", async () => {
    const targetFile = "src/broken_test.ts";
    const mockReconciler: FinalWorkspaceReconciler = {
      async reconcile() {
        return {
          reconciliationId: "recon-vfail-1",
          runId: "run-5w-3",
          planId: "plan-5w-3",
          status: "inconsistent",
          checkedAt: Date.now(),
          expectedFiles: [targetFile],
          modifiedFiles: [targetFile],
          unexpectedFiles: [],
          missingFiles: [],
          changedFiles: [],
          branchChanged: false,
          workspaceChanged: false,
          verificationPassed: false,
          consistent: false,
          failureReason: "Verification check failed"
        };
      }
    };

    const mockCmdExecutor = {
      async execute(cmd: string) {
        return {
          command: cmd,
          exitCode: 1,
          stdout: "",
          stderr: "1 test failed",
          timedOut: false,
          truncated: false
        };
      }
    };

    const recoveryManager = new DefaultExecutionRecoveryManager({
      executionPolicy: riskPolicy,
      reconciler: mockReconciler,
      commandExecutor: mockCmdExecutor
    });

    const plan = createTaskPlan({
      planId: "plan-5w-3",
      runId: "run-5w-3",
      userRequestSummary: "Create failing helper",
      objective: "Failing helper",
      steps: []
    });

    const assessment: ExecutionRecoveryAssessment = {
      eligible: true,
      strategy: "repair",
      riskLevel: "normal",
      riskReasons: [],
      workspaceDrift: false,
      affectedSteps: [],
      affectedFiles: [targetFile],
      requiresExplicitApproval: true,
      reason: "Repair file",
      recoveryDepth: 0,
      maxRecoveryDepth: 5,
      isLimitReached: false,
      repairActions: [
        {
          target: targetFile,
          operation: "create_file",
          reason: "Repair missing file",
          content: "throw new Error('fail');\n"
        }
      ]
    };

    const events: AgentEvent[] = [];
    for await (const ev of recoveryManager.executeRecovery(plan, assessment, {
      cwd: tmpDir,
      approved: true
    })) {
      events.push(ev);
    }

    const outcomeEv = events.find((e) => e.type === "recovery_outcome_determined");
    expect(outcomeEv).toBeDefined();
    if (outcomeEv && outcomeEv.type === "recovery_outcome_determined") {
      expect(outcomeEv.outcome).toBe("still_blocked");
      expect(outcomeEv.result.status).toBe("blocked");
      expect(outcomeEv.result.workspaceConsistent).toBe(false);
      expect(outcomeEv.result.verificationResult?.success).toBe(false);
      expect(outcomeEv.result.blockingReasons).toBeDefined();
    }

    const stillBlockedEv = events.find((e) => e.type === "recovery_still_blocked");
    expect(stillBlockedEv).toBeDefined();
  });

  it("handles partial recovery by recording both completed and failed actions", async () => {
    const validFile = "src/valid.ts";
    const invalidFile = "invalid:\0/path.ts";

    const mockReconciler: FinalWorkspaceReconciler = {
      async reconcile() {
        return {
          reconciliationId: "recon-partial-1",
          runId: "run-5w-4",
          planId: "plan-5w-4",
          status: "inconsistent",
          checkedAt: Date.now(),
          expectedFiles: [validFile, invalidFile],
          modifiedFiles: [validFile],
          unexpectedFiles: [],
          missingFiles: [invalidFile],
          changedFiles: [],
          branchChanged: false,
          workspaceChanged: true,
          verificationPassed: true,
          consistent: false,
          failureReason: `Missing expected files: ${invalidFile}`
        };
      }
    };

    const recoveryManager = new DefaultExecutionRecoveryManager({
      executionPolicy: riskPolicy,
      reconciler: mockReconciler
    });

    const plan = createTaskPlan({
      planId: "plan-5w-4",
      runId: "run-5w-4",
      userRequestSummary: "Partial repair",
      objective: "Partial",
      steps: []
    });

    const assessment: ExecutionRecoveryAssessment = {
      eligible: true,
      strategy: "repair",
      riskLevel: "normal",
      riskReasons: [],
      workspaceDrift: false,
      affectedSteps: [],
      affectedFiles: [validFile, invalidFile],
      requiresExplicitApproval: true,
      reason: "Partial repair test",
      recoveryDepth: 0,
      maxRecoveryDepth: 5,
      isLimitReached: false,
      repairActions: [
        {
          target: validFile,
          operation: "create_file",
          reason: "Repair valid file",
          content: "export const valid = true;\n"
        },
        {
          target: invalidFile,
          operation: "create_file",
          reason: "Repair invalid file",
          content: "fail\n"
        }
      ]
    };

    const events: AgentEvent[] = [];
    for await (const ev of recoveryManager.executeRecovery(plan, assessment, {
      cwd: tmpDir,
      approved: true
    })) {
      events.push(ev);
    }

    const outcomeEv = events.find((e) => e.type === "recovery_outcome_determined");
    expect(outcomeEv).toBeDefined();
    if (outcomeEv && outcomeEv.type === "recovery_outcome_determined") {
      expect(outcomeEv.outcome).toBe("still_blocked");
      expect(outcomeEv.result.completedRecoveryActions?.length).toBe(1);
      expect(outcomeEv.result.completedRecoveryActions?.[0].target).toBe(validFile);
      expect(outcomeEv.result.failedRecoveryActions?.length).toBe(1);
      expect(outcomeEv.result.failedRecoveryActions?.[0].action.target).toBe(invalidFile);
      expect(outcomeEv.result.repairedFiles).toContain(validFile);
    }
  });

  it("synchronizes plan status to 'executing' when steps remain, and 'completed' when all done", async () => {
    const targetFile = "src/sync_plan.ts";
    const mockReconciler: FinalWorkspaceReconciler = {
      async reconcile() {
        return {
          reconciliationId: "recon-sync-1",
          runId: "run-5w-5",
          planId: "plan-5w-5",
          status: "consistent",
          checkedAt: Date.now(),
          expectedFiles: [targetFile],
          modifiedFiles: [targetFile],
          unexpectedFiles: [],
          missingFiles: [],
          changedFiles: [],
          branchChanged: false,
          workspaceChanged: false,
          verificationPassed: true,
          consistent: true
        };
      }
    };

    const recoveryManager = new DefaultExecutionRecoveryManager({
      executionPolicy: riskPolicy,
      reconciler: mockReconciler
    });

    const planWithRemaining = createTaskPlan({
      planId: "plan-5w-5",
      runId: "run-5w-5",
      userRequestSummary: "Remaining steps plan",
      objective: "Remaining",
      status: "blocked",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Step 1",
          objective: "Step 1",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "completed",
          expectedFiles: [targetFile]
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Step 2",
          objective: "Step 2",
          type: "inspect",
          dependencies: ["step-1"],
          riskLevel: "low",
          verificationRequired: false,
          status: "pending"
        }
      ]
    });

    const assessment: ExecutionRecoveryAssessment = {
      eligible: true,
      strategy: "repair",
      riskLevel: "normal",
      riskReasons: [],
      workspaceDrift: false,
      affectedSteps: ["step-1"],
      affectedFiles: [targetFile],
      requiresExplicitApproval: true,
      reason: "Repair step 1",
      recoveryDepth: 0,
      maxRecoveryDepth: 5,
      isLimitReached: false,
      repairActions: [
        {
          target: targetFile,
          operation: "create_file",
          reason: "Repair file",
          content: "export const a = 10;\n"
        }
      ]
    };

    const events: AgentEvent[] = [];
    for await (const ev of recoveryManager.executeRecovery(planWithRemaining, assessment, {
      cwd: tmpDir,
      approved: true
    })) {
      events.push(ev);
    }

    const outcomeEv = events.find((e) => e.type === "recovery_outcome_determined");
    expect(outcomeEv).toBeDefined();
    if (outcomeEv && outcomeEv.type === "recovery_outcome_determined") {
      expect(outcomeEv.result.finalPlanStatus).toBe("executing");
      expect(planWithRemaining.status).toBe("executing");
    }
  });

  it("handles cancellation gracefully during recovery", async () => {
    const targetFile = "src/cancelled.ts";
    const controller = new AbortController();
    controller.abort(); // pre-aborted

    const mockReconciler: FinalWorkspaceReconciler = {
      async reconcile() {
        return {
          reconciliationId: "recon-cancel",
          runId: "run-5w-6",
          planId: "plan-5w-6",
          status: "inconsistent",
          checkedAt: Date.now(),
          expectedFiles: [],
          modifiedFiles: [],
          unexpectedFiles: [],
          missingFiles: [],
          changedFiles: [],
          branchChanged: false,
          workspaceChanged: false,
          verificationPassed: false,
          consistent: false
        };
      }
    };

    const recoveryManager = new DefaultExecutionRecoveryManager({
      executionPolicy: riskPolicy,
      reconciler: mockReconciler
    });

    const plan = createTaskPlan({
      planId: "plan-5w-6",
      runId: "run-5w-6",
      userRequestSummary: "Cancel test",
      objective: "Cancel",
      steps: []
    });

    const assessment: ExecutionRecoveryAssessment = {
      eligible: true,
      strategy: "repair",
      riskLevel: "normal",
      riskReasons: [],
      workspaceDrift: false,
      affectedSteps: [],
      affectedFiles: [targetFile],
      requiresExplicitApproval: true,
      reason: "Cancel test",
      recoveryDepth: 0,
      maxRecoveryDepth: 5,
      isLimitReached: false
    };

    const events: AgentEvent[] = [];
    for await (const ev of recoveryManager.executeRecovery(plan, assessment, {
      cwd: tmpDir,
      approved: true,
      signal: controller.signal
    })) {
      events.push(ev);
    }

    const cancelEv = events.find((e) => e.type === "recovery_cancelled");
    expect(cancelEv).toBeDefined();
  });
});

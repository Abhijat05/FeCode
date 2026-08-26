import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultRecoveryContinuationManager } from "./continuationManager.js";
import { DefaultTaskRiskPolicy } from "../policy/taskRiskPolicy.js";
import { createTaskPlan } from "./taskPlan.js";
import type {
  FinalWorkspaceReconciler,
  PlanExecutor
} from "./types.js";
import type { AgentEvent } from "../index.js";

describe("Phase 5X — Recovery Continuation & Plan Completion", () => {
  let tmpDir: string;
  let riskPolicy: DefaultTaskRiskPolicy;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-5x-test-"));
    riskPolicy = new DefaultTaskRiskPolicy();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("prepares continuation successfully for recovered plan with remaining steps", async () => {
    const mockReconciler: FinalWorkspaceReconciler = {
      async reconcile() {
        return {
          reconciliationId: "recon-5x-1",
          runId: "run-5x-1",
          planId: "plan-5x-1",
          status: "consistent",
          checkedAt: Date.now(),
          expectedFiles: ["src/step1.ts"],
          modifiedFiles: ["src/step1.ts"],
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

    const mockExecutor: PlanExecutor = {
      async *executePlan() {
        yield {
          type: "plan_step_completed",
          planId: "plan-5x-1",
          stepId: "step-2",
          stepIndex: 1,
          timestamp: Date.now()
        };
      }
    };

    const continuationManager = new DefaultRecoveryContinuationManager({
      executionPolicy: riskPolicy,
      reconciler: mockReconciler,
      planExecutor: mockExecutor
    });

    const plan = createTaskPlan({
      planId: "plan-5x-1",
      runId: "run-5x-1",
      userRequestSummary: "Multi-step task",
      objective: "Task",
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
          status: "completed"
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Step 2",
          objective: "Step 2",
          type: "modify",
          dependencies: ["step-1"],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending"
        }
      ]
    });

    const prep = await continuationManager.prepareContinuation(plan, {
      cwd: tmpDir,
      recoveryOutcome: "recovered"
    });

    expect(prep.eligible).toBe(true);
    expect(prep.canContinue).toBe(true);
    expect(prep.requiresExplicitApproval).toBe(true);
    expect(prep.remainingSteps.length).toBe(1);
    expect(prep.remainingSteps[0].stepId).toBe("step-2");
    expect(prep.completedSteps.length).toBe(1);
  });

  it("prepares continuation with explicit approval required for recovered_with_changes", async () => {
    const mockReconciler: FinalWorkspaceReconciler = {
      async reconcile() {
        return {
          reconciliationId: "recon-5x-2",
          runId: "run-5x-2",
          planId: "plan-5x-2",
          status: "consistent",
          checkedAt: Date.now(),
          expectedFiles: ["src/step1.ts"],
          modifiedFiles: ["src/step1.ts"],
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

    const mockExecutor: PlanExecutor = {
      async *executePlan() {
        // empty
      }
    };

    const continuationManager = new DefaultRecoveryContinuationManager({
      executionPolicy: riskPolicy,
      reconciler: mockReconciler,
      planExecutor: mockExecutor
    });

    const plan = createTaskPlan({
      planId: "plan-5x-2",
      runId: "run-5x-2",
      userRequestSummary: "Diff task",
      objective: "Diff task",
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
          status: "pending"
        }
      ]
    });

    const prep = await continuationManager.prepareContinuation(plan, {
      cwd: tmpDir,
      recoveryOutcome: "recovered_with_changes"
    });

    expect(prep.eligible).toBe(true);
    expect(prep.canContinue).toBe(true);
    expect(prep.recoveryOutcome).toBe("recovered_with_changes");
  });

  it("forbids continuation when recovery outcome is still_blocked", async () => {
    const mockReconciler: FinalWorkspaceReconciler = {
      async reconcile() {
        return {
          reconciliationId: "recon-5x-3",
          runId: "run-5x-3",
          planId: "plan-5x-3",
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

    const mockExecutor: PlanExecutor = {
      async *executePlan() {
        // empty
      }
    };

    const continuationManager = new DefaultRecoveryContinuationManager({
      executionPolicy: riskPolicy,
      reconciler: mockReconciler,
      planExecutor: mockExecutor
    });

    const plan = createTaskPlan({
      planId: "plan-5x-3",
      runId: "run-5x-3",
      userRequestSummary: "Blocked task",
      objective: "Blocked",
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
          status: "pending"
        }
      ]
    });

    const prep = await continuationManager.prepareContinuation(plan, {
      cwd: tmpDir,
      recoveryOutcome: "still_blocked"
    });

    expect(prep.eligible).toBe(false);
    expect(prep.canContinue).toBe(false);
    expect(prep.reason).toContain("still blocked");
  });

  it("forbids continuation when all plan steps are already completed", async () => {
    const mockReconciler: FinalWorkspaceReconciler = {
      async reconcile() {
        return {
          reconciliationId: "recon-5x-4",
          runId: "run-5x-4",
          planId: "plan-5x-4",
          status: "consistent",
          checkedAt: Date.now(),
          expectedFiles: [],
          modifiedFiles: [],
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

    const mockExecutor: PlanExecutor = {
      async *executePlan() {
        // empty
      }
    };

    const continuationManager = new DefaultRecoveryContinuationManager({
      executionPolicy: riskPolicy,
      reconciler: mockReconciler,
      planExecutor: mockExecutor
    });

    const plan = createTaskPlan({
      planId: "plan-5x-4",
      runId: "run-5x-4",
      userRequestSummary: "Completed task",
      objective: "Completed",
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
          status: "completed"
        }
      ]
    });

    const prep = await continuationManager.prepareContinuation(plan, {
      cwd: tmpDir,
      recoveryOutcome: "recovered"
    });

    expect(prep.canContinue).toBe(false);
    expect(prep.remainingSteps.length).toBe(0);
    expect(plan.status).toBe("completed");
  });

  it("executes continuation and resumes remaining steps when user approves continue", async () => {
    const targetFile = "src/cont_out.ts";
    const mockReconciler: FinalWorkspaceReconciler = {
      async reconcile() {
        return {
          reconciliationId: "recon-5x-5",
          runId: "run-5x-5",
          planId: "plan-5x-5",
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

    const mockExecutor: PlanExecutor = {
      async *executePlan(planToExecute) {
        planToExecute.steps[1].status = "completed";
        planToExecute.status = "completed";
        yield {
          type: "plan_step_started",
          planId: planToExecute.planId,
          stepId: "step-2",
          stepIndex: 1,
          title: "Step 2",
          timestamp: Date.now()
        };
        yield {
          type: "plan_step_completed",
          planId: planToExecute.planId,
          stepId: "step-2",
          stepIndex: 1,
          durationMs: 30,
          timestamp: Date.now()
        };
        yield {
          type: "plan_execution_completed",
          planId: planToExecute.planId,
          completedSteps: 2,
          totalSteps: 2,
          durationMs: 50,
          timestamp: Date.now()
        };
      }
    };

    const continuationManager = new DefaultRecoveryContinuationManager({
      executionPolicy: riskPolicy,
      reconciler: mockReconciler,
      planExecutor: mockExecutor
    });

    const plan = createTaskPlan({
      planId: "plan-5x-5",
      runId: "run-5x-5",
      userRequestSummary: "Execute continuation",
      objective: "Continuation",
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
          status: "completed"
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Step 2",
          objective: "Step 2",
          type: "modify",
          dependencies: ["step-1"],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending"
        }
      ]
    });

    const prep = await continuationManager.prepareContinuation(plan, {
      cwd: tmpDir,
      recoveryOutcome: "recovered"
    });

    const events: AgentEvent[] = [];
    for await (const ev of continuationManager.executeContinuation(plan, prep, {
      runId: plan.runId,
      planId: plan.planId,
      decision: "continue",
      approved: true,
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const completedEv = events.find(
      (e) => e.type === "recovery_continuation_completed"
    );
    expect(completedEv).toBeDefined();
    if (completedEv && completedEv.type === "recovery_continuation_completed") {
      expect(completedEv.result.status).toBe("completed");
      expect(completedEv.result.finalPlanStatus).toBe("completed");
      expect(completedEv.result.resumedStepIds).toContain("step-2");
      expect(completedEv.result.completedStepIds).toContain("step-1");
      expect(completedEv.result.completedStepIds).toContain("step-2");
    }
  });

  it("cancels continuation cleanly when user declines approval or cancels", async () => {
    const mockReconciler: FinalWorkspaceReconciler = {
      async reconcile() {
        return {
          reconciliationId: "recon-5x-6",
          runId: "run-5x-6",
          planId: "plan-5x-6",
          status: "consistent",
          checkedAt: Date.now(),
          expectedFiles: [],
          modifiedFiles: [],
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

    const mockExecutor: PlanExecutor = {
      async *executePlan() {
        // empty
      }
    };

    const continuationManager = new DefaultRecoveryContinuationManager({
      executionPolicy: riskPolicy,
      reconciler: mockReconciler,
      planExecutor: mockExecutor
    });

    const plan = createTaskPlan({
      planId: "plan-5x-6",
      runId: "run-5x-6",
      userRequestSummary: "Decline continuation",
      objective: "Decline",
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
          status: "pending"
        }
      ]
    });

    const prep = await continuationManager.prepareContinuation(plan, {
      cwd: tmpDir,
      recoveryOutcome: "recovered"
    });

    const events: AgentEvent[] = [];
    for await (const ev of continuationManager.executeContinuation(plan, prep, {
      runId: plan.runId,
      planId: plan.planId,
      decision: "cancel",
      approved: false,
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const cancelEv = events.find(
      (e) => e.type === "recovery_continuation_cancelled"
    );
    expect(cancelEv).toBeDefined();
    if (cancelEv && cancelEv.type === "recovery_continuation_cancelled") {
      expect(cancelEv.result.status).toBe("cancelled");
      expect(cancelEv.result.decision).toBe("cancel");
    }
  });

  it("blocks continuation if workspace reconciliation gate fails right before execution", async () => {
    let callCount = 0;
    const mockReconciler: FinalWorkspaceReconciler = {
      async reconcile() {
        callCount++;
        // First call passes (in prepare), second call fails (in gate check)
        if (callCount === 1) {
          return {
            reconciliationId: "recon-pass",
            runId: "run-5x-7",
            planId: "plan-5x-7",
            status: "consistent",
            checkedAt: Date.now(),
            expectedFiles: [],
            modifiedFiles: [],
            unexpectedFiles: [],
            missingFiles: [],
            changedFiles: [],
            branchChanged: false,
            workspaceChanged: false,
            verificationPassed: true,
            consistent: true
          };
        }
        return {
          reconciliationId: "recon-fail",
          runId: "run-5x-7",
          planId: "plan-5x-7",
          status: "inconsistent",
          checkedAt: Date.now(),
          expectedFiles: [],
          modifiedFiles: [],
          unexpectedFiles: ["tampered.txt"],
          missingFiles: [],
          changedFiles: ["tampered.txt"],
          branchChanged: false,
          workspaceChanged: true,
          verificationPassed: true,
          consistent: false,
          failureReason: "Unexpected changes detected: tampered.txt"
        };
      }
    };

    const mockExecutor: PlanExecutor = {
      async *executePlan() {
        yield {
          type: "plan_execution_failed",
          planId: "fail",
          reason: "Gate should prevent this",
          timestamp: Date.now()
        };
        throw new Error("Should not execute plan when gate fails");
      }
    };

    const continuationManager = new DefaultRecoveryContinuationManager({
      executionPolicy: riskPolicy,
      reconciler: mockReconciler,
      planExecutor: mockExecutor
    });

    const plan = createTaskPlan({
      planId: "plan-5x-7",
      runId: "run-5x-7",
      userRequestSummary: "Gate check task",
      objective: "Gate check",
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
          status: "pending"
        }
      ]
    });

    const prep = await continuationManager.prepareContinuation(plan, {
      cwd: tmpDir,
      recoveryOutcome: "recovered"
    });
    expect(prep.canContinue).toBe(true);

    const events: AgentEvent[] = [];
    for await (const ev of continuationManager.executeContinuation(plan, prep, {
      runId: plan.runId,
      planId: plan.planId,
      decision: "continue",
      approved: true,
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const blockedEv = events.find(
      (e) => e.type === "recovery_continuation_blocked"
    );
    expect(blockedEv).toBeDefined();
    if (blockedEv && blockedEv.type === "recovery_continuation_blocked") {
      expect(blockedEv.result.status).toBe("blocked");
      expect(blockedEv.blockingReasons[0]).toContain("Unexpected changes");
    }
  });
});

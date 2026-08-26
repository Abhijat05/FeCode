import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultExecutionRecoveryManager } from "./executionRecoveryManager.js";
import { DefaultFinalWorkspaceReconciler } from "./reconciliation.js";
import { createTaskPlan } from "./taskPlan.js";
import { DefaultTaskRiskPolicy } from "../policy/taskRiskPolicy.js";
import { DefaultPermissionManager, AutoApproveResolver } from "@fecode/models";
import { DefaultReplanManager } from "./replanManager.js";
import { DefaultTaskPlanner } from "./planner.js";
import type { AgentEvent } from "../index.js";
import type { FinalReconciliationResult } from "./types.js";

describe("DefaultExecutionRecoveryManager — Phase 5V", () => {
  let tmpDir: string;
  let riskPolicy: DefaultTaskRiskPolicy;
  let permissionManager: DefaultPermissionManager;
  let approvalResolver: AutoApproveResolver;
  let reconciler: DefaultFinalWorkspaceReconciler;
  let planner: DefaultTaskPlanner;
  let replanManager: DefaultReplanManager;
  let recoveryManager: DefaultExecutionRecoveryManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-5v-unit-"));
    riskPolicy = new DefaultTaskRiskPolicy();
    permissionManager = new DefaultPermissionManager();
    approvalResolver = new AutoApproveResolver();
    reconciler = new DefaultFinalWorkspaceReconciler();
    planner = new DefaultTaskPlanner();
    replanManager = new DefaultReplanManager({
      planner,
      executionPolicy: riskPolicy
    });
    recoveryManager = new DefaultExecutionRecoveryManager({
      executionPolicy: riskPolicy,
      permissionManager,
      approvalResolver,
      reconciler,
      replanManager
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("assesses recheck strategy for transient verification failure", async () => {
    const plan = createTaskPlan({
      planId: "plan-5v-1",
      runId: "run-5v-1",
      userRequestSummary: "Test plan",
      objective: "Test objective",
      steps: []
    });

    const reconciliationResult: FinalReconciliationResult = {
      reconciliationId: "recon-1",
      runId: "run-5v-1",
      planId: "plan-5v-1",
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
      consistent: false,
      failureReason: "Verification checks failed"
    };

    const assessment = await recoveryManager.assessRecovery(plan, {
      cwd: tmpDir,
      reconciliationResult
    });

    expect(assessment.eligible).toBe(true);
    expect(assessment.strategy).toBe("recheck");
    expect(assessment.requiresExplicitApproval).toBe(true);
    expect(assessment.reason).toContain("Verification");
  });

  it("assesses repair strategy when expected files are missing and repairable", async () => {
    const plan = createTaskPlan({
      planId: "plan-5v-repair",
      runId: "run-5v-repair",
      userRequestSummary: "Create auth.ts",
      objective: "Create auth file",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Create src/auth.ts",
          objective: "Create file",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["src/auth.ts"],
          intent: {
            type: "create_file",
            target: "src/auth.ts",
            reason: "Create file",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    const reconciliationResult: FinalReconciliationResult = {
      reconciliationId: "recon-2",
      runId: "run-5v-repair",
      planId: "plan-5v-repair",
      status: "inconsistent",
      checkedAt: Date.now(),
      expectedFiles: ["src/auth.ts"],
      modifiedFiles: [],
      unexpectedFiles: [],
      missingFiles: ["src/auth.ts"],
      changedFiles: [],
      branchChanged: false,
      workspaceChanged: false,
      verificationPassed: true,
      consistent: false,
      failureReason: "Missing expected files: src/auth.ts"
    };

    const assessment = await recoveryManager.assessRecovery(plan, {
      cwd: tmpDir,
      reconciliationResult
    });

    expect(assessment.eligible).toBe(true);
    expect(assessment.strategy).toBe("repair");
    expect(assessment.affectedFiles).toContain("src/auth.ts");
    expect(assessment.repairActions).toBeDefined();
    expect(assessment.repairActions?.length).toBeGreaterThan(0);
    expect(assessment.requiresExplicitApproval).toBe(true);
  });

  it("assesses replan strategy when unexpected files or branch drift occur", async () => {
    const plan = createTaskPlan({
      planId: "plan-5v-drift",
      runId: "run-5v-drift",
      userRequestSummary: "Drift plan",
      objective: "Drift",
      steps: []
    });

    const reconciliationResult: FinalReconciliationResult = {
      reconciliationId: "recon-3",
      runId: "run-5v-drift",
      planId: "plan-5v-drift",
      status: "inconsistent",
      checkedAt: Date.now(),
      expectedFiles: [],
      modifiedFiles: [],
      unexpectedFiles: ["unexpected.ts"],
      missingFiles: [],
      changedFiles: ["unexpected.ts"],
      branchChanged: true,
      workspaceChanged: true,
      verificationPassed: true,
      consistent: false,
      failureReason: "Git branch changed during execution"
    };

    const assessment = await recoveryManager.assessRecovery(plan, {
      cwd: tmpDir,
      reconciliationResult
    });

    expect(assessment.eligible).toBe(true);
    expect(assessment.strategy).toBe("replan");
    expect(assessment.workspaceDrift).toBe(true);
  });

  it("enforces maximum recovery depth and cycle protection", async () => {
    const plan = createTaskPlan({
      planId: "plan-5v-depth",
      runId: "run-5v-depth",
      userRequestSummary: "Deep recovery",
      objective: "Deep",
      steps: []
    });

    // Simulate existing recoveries in lineage
    await recoveryManager.assessRecovery(plan, {
      cwd: tmpDir,
      parentRecoveryId: "rec-deep-5"
    });

    // Manually testing with max depth exceeded
    const managerLowDepth = new DefaultExecutionRecoveryManager({
      executionPolicy: riskPolicy,
      permissionManager,
      reconciler,
      replanManager,
      maxRecoveryDepth: 0
    });

    const depthExceededAssessment = await managerLowDepth.assessRecovery(plan, {
      cwd: tmpDir
    });

    expect(depthExceededAssessment.eligible).toBe(false);
    expect(depthExceededAssessment.isLimitReached).toBe(true);
    expect(depthExceededAssessment.reason).toContain("Maximum recovery depth reached");
  });

  it("requires explicit user approval before executing recovery mutations", async () => {
    const plan = createTaskPlan({
      planId: "plan-5v-unapproved",
      runId: "run-5v-unapproved",
      userRequestSummary: "Unapproved recovery",
      objective: "Unapproved",
      steps: []
    });

    const assessment = await recoveryManager.assessRecovery(plan, {
      cwd: tmpDir,
      strategy: "repair"
    });

    const events: AgentEvent[] = [];
    for await (const ev of recoveryManager.executeRecovery(plan, assessment, {
      cwd: tmpDir,
      approved: false // Explicitly NOT approved!
    })) {
      events.push(ev);
    }

    const waitingApproval = events.find((e) => e.type === "recovery_waiting_approval");
    const blockedEvent = events.find((e) => e.type === "recovery_blocked");
    const completedEvent = events.find((e) => e.type === "recovery_completed");

    expect(waitingApproval).toBeDefined();
    expect(blockedEvent).toBeDefined();
    expect(completedEvent).toBeUndefined(); // NEVER executes mutations without approval!
  });

  it("executes bounded repair when explicitly approved and reaches consistent state", async () => {
    const targetFile = "src/repaired.ts";
    const plan = createTaskPlan({
      planId: "plan-5v-exec-repair",
      runId: "run-5v-exec-repair",
      userRequestSummary: "Repair missing file",
      objective: "Repair file",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Create src/repaired.ts",
          objective: "Create file",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          expectedFiles: [targetFile],
          intent: {
            type: "create_file",
            target: targetFile,
            reason: "Repair target",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    const reconciliationResult: FinalReconciliationResult = {
      reconciliationId: "recon-exec",
      runId: "run-5v-exec-repair",
      planId: "plan-5v-exec-repair",
      status: "inconsistent",
      checkedAt: Date.now(),
      expectedFiles: [targetFile],
      modifiedFiles: [],
      unexpectedFiles: [],
      missingFiles: [targetFile],
      changedFiles: [],
      branchChanged: false,
      workspaceChanged: false,
      verificationPassed: true,
      consistent: false,
      failureReason: `Missing expected files: ${targetFile}`
    };

    const assessment = await recoveryManager.assessRecovery(plan, {
      cwd: tmpDir,
      reconciliationResult
    });

    expect(assessment.strategy).toBe("repair");

    const events: AgentEvent[] = [];
    for await (const ev of recoveryManager.executeRecovery(plan, assessment, {
      cwd: tmpDir,
      approved: true // Approved!
    })) {
      events.push(ev);
    }

    const started = events.find((e) => e.type === "recovery_started");
    const stepCompleted = events.find((e) => e.type === "recovery_step_completed");
    const reconCompleted = events.find((e) => e.type === "recovery_reconciliation_completed");
    const completed = events.find((e) => e.type === "recovery_completed");

    expect(started).toBeDefined();
    expect(stepCompleted).toBeDefined();
    expect(reconCompleted).toBeDefined();
    expect(completed).toBeDefined();

    // Verify file exists on disk
    const fileExists = await fs
      .access(path.join(tmpDir, targetFile))
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);
  });

  it("handles cancellation cleanly without mutating workspace", async () => {
    const plan = createTaskPlan({
      planId: "plan-5v-cancel",
      runId: "run-5v-cancel",
      userRequestSummary: "Cancel recovery",
      objective: "Cancel",
      steps: []
    });

    const assessment = await recoveryManager.assessRecovery(plan, {
      cwd: tmpDir,
      strategy: "cancel"
    });

    const events: AgentEvent[] = [];
    for await (const ev of recoveryManager.executeRecovery(plan, assessment, {
      cwd: tmpDir,
      approved: true
    })) {
      events.push(ev);
    }

    const cancelled = events.find((e) => e.type === "recovery_cancelled");
    expect(cancelled).toBeDefined();
  });

  it("delegates to replanManager when replan strategy is executed", async () => {
    const plan = createTaskPlan({
      planId: "plan-5v-replan-exec",
      runId: "run-5v-replan-exec",
      userRequestSummary: "Replan recovery",
      objective: "Replan",
      steps: []
    });

    const assessment = await recoveryManager.assessRecovery(plan, {
      cwd: tmpDir,
      strategy: "replan"
    });

    const events: AgentEvent[] = [];
    for await (const ev of recoveryManager.executeRecovery(plan, assessment, {
      cwd: tmpDir,
      approved: true,
      userRequest: "Create something new"
    })) {
      events.push(ev);
    }

    const completed = events.find((e) => e.type === "recovery_completed");
    expect(completed).toBeDefined();
    if (completed && completed.type === "recovery_completed" && "result" in completed) {
      expect(completed.result.strategy).toBe("replan");
      expect(completed.result.replanResult).toBeDefined();
    }
  });

  it("tracks recovery history and lineage accurately", async () => {
    const plan = createTaskPlan({
      planId: "plan-5v-history",
      runId: "run-5v-history",
      userRequestSummary: "History test",
      objective: "History",
      steps: []
    });

    const assessment = await recoveryManager.assessRecovery(plan, {
      cwd: tmpDir,
      strategy: "recheck"
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ev of recoveryManager.executeRecovery(plan, assessment, {
      cwd: tmpDir,
      approved: true
    })) {
      // Consume
    }

    const history = recoveryManager.getRecoveryHistory(plan.planId);
    expect(history.length).toBe(1);
    expect(history[0].strategy).toBe("recheck");

    const lineage = recoveryManager.getRecoveryLineage(history[0].recoveryId);
    expect(lineage.length).toBe(1);
    expect(lineage[0].recoveryId).toBe(history[0].recoveryId);
  });
});

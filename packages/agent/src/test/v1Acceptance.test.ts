import { describe, it, expect } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultAgentRunStateMachine } from "../run/stateMachine.js";
import { DefaultStepRetryPolicy } from "../planning/retryPolicy.js";
import { DefaultResumeManager } from "../history/resumeManager.js";
import { DefaultRunHistoryStore } from "../history/runHistoryStore.js";
import { DefaultCheckpointManager } from "../checkpoints/checkpointManager.js";
import { DefaultTaskRiskPolicy } from "../policy/taskRiskPolicy.js";
import {
  transitionPlanStatus,
  createTaskPlan,
  startPlanStep,
  completePlanStep
} from "../planning/taskPlan.js";
import { detectPlanStaleness } from "../planning/staleness.js";
import { DefaultExecutionHandoffManager } from "../planning/handoffManager.js";
import { DefaultRecoveryContinuationManager } from "../planning/continuationManager.js";
import { DefaultFinalWorkspaceReconciler } from "../planning/reconciliation.js";
import { getProjectIdentifier } from "../history/projectIdentifier.js";
import { filterCommands } from "../../../../apps/cli/src/commands.js";
import { InteractiveApprovalResolver } from "../../../../apps/cli/src/approvalResolver.js";
import { createDefaultToolRegistry } from "../tools/defaultRegistry.js";
import {
  DefaultToolExecutor,
  DefaultPermissionManager
} from "@fecode/models";
import type { PlanStep, TaskPlan, PlanExecutor } from "../planning/types.js";
import type { GitRepository, GitStatus } from "../git/types.js";
import type { DurableRunRecord } from "../history/types.js";

function makePlan(overrides?: Partial<TaskPlan>): TaskPlan {
  return createTaskPlan({
    runId: "run-v1-acceptance",
    userRequestSummary: "V1 Acceptance Test Request",
    objective: "V1 Acceptance Test Objective",
    steps: [
      {
        stepId: "step-1",
        order: 1,
        title: "Read codebase config",
        objective: "Inspect package.json",
        type: "inspect",
        dependencies: [],
        riskLevel: "low",
        verificationRequired: false,
        status: "pending",
        intent: {
          type: "inspect_file",
          target: "package.json",
          reason: "Read config",
          requiresApproval: false,
          estimatedRisk: "low"
        }
      }
    ],
    ...overrides
  });
}

describe("FeCode V1 Acceptance Suite — 18 Mandatory Scenarios", () => {
  // SCENARIO 1: Simple read-only task
  it("Scenario 1: Simple read-only task transitions plan -> ready -> approved -> executing -> completed", () => {
    const plan = makePlan({ status: "ready" });
    expect(plan.status).toBe("ready");

    const approved = transitionPlanStatus(plan, "approved");
    expect(approved.status).toBe("approved");

    const startedStep = startPlanStep(approved, "step-1");
    expect(startedStep.status).toBe("executing");
    expect(startedStep.steps[0].status).toBe("in_progress");

    const completedStep = completePlanStep(startedStep, "step-1");
    expect(completedStep.steps[0].status).toBe("completed");

    const finished = transitionPlanStatus(completedStep, "completed");
    expect(finished.status).toBe("completed");
  });

  // SCENARIO 2: Simple file modification
  it("Scenario 2: Simple file modification assesses risk, prepares handoff with tool execution", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-v1-s2-"));
    const targetFile = path.join(tmpDir, "config.json");
    await fs.writeFile(targetFile, JSON.stringify({ version: "1.0.0" }), "utf-8");

    const policy = new DefaultTaskRiskPolicy();
    const registry = createDefaultToolRegistry();
    const executor = new DefaultToolExecutor(registry);
    const permissions = new DefaultPermissionManager();

    const handoff = new DefaultExecutionHandoffManager({
      registry,
      executor,
      permissionManager: permissions,
      executionPolicy: policy
    });

    const step: PlanStep = {
      stepId: "step-mod-1",
      order: 1,
      title: "Modify config",
      objective: "Update setting",
      type: "modify",
      dependencies: [],
      expectedFiles: [targetFile],
      riskLevel: "normal",
      verificationRequired: true,
      status: "pending",
      intent: {
        type: "modify_file",
        target: targetFile,
        reason: "Update setting",
        requiresApproval: true,
        estimatedRisk: "normal"
      }
    };

    const prep = await handoff.prepareHandoff({
      runId: "run-s2",
      planId: "plan-s2",
      step,
      cwd: tmpDir
    });

    expect(prep.canExecute).toBe(true);
    expect(prep.effectiveRisk).toBe("normal");
    expect(prep.toolCall?.name).toBe("edit_file");

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  // SCENARIO 3: Elevated multi-file change
  it("Scenario 3: Elevated multi-file change triggers elevated risk and requires checkpoint/approval", async () => {
    const policy = new DefaultTaskRiskPolicy();
    const assessment = policy.assess({
      userMessage: "delete all configuration files and database",
      cwd: process.cwd(),
      affectedFiles: ["src/schema.ts", "src/models.ts", "package.json", "db.sqlite"],
      operations: ["delete_file", "execute_command"]
    });

    expect(["elevated", "critical"]).toContain(assessment.level);
    expect(assessment.requiresCheckpoint).toBe(true);
    expect(assessment.requiresExplicitApproval).toBe(true);
  });

  // SCENARIO 4: Verification failure
  it("Scenario 4: Verification failure respects bounded step retry limits", () => {
    const retryPolicy = new DefaultStepRetryPolicy({ maxAttempts: 2 });
    const step: PlanStep = {
      stepId: "step-test",
      order: 1,
      title: "Run unit tests",
      objective: "Verify changes",
      type: "verify",
      dependencies: [],
      riskLevel: "low",
      verificationRequired: false,
      status: "pending"
    };

    // Attempt 1: allowed to retry
    expect(retryPolicy.canRetry(step, 1, "verification_failed")).toBe(true);
    expect(retryPolicy.getRemainingAttempts("step-test", 1)).toBe(1);

    // Attempt 2: limit reached, blocked
    expect(retryPolicy.canRetry(step, 2, "verification_failed")).toBe(false);
    expect(retryPolicy.getRemainingAttempts("step-test", 2)).toBe(0);
  });

  // SCENARIO 5: Plan becomes stale
  it("Scenario 5: Plan becomes stale when expected target file disappears, transitioning to blocked", async () => {
    const plan = makePlan();
    const step: PlanStep = {
      stepId: "step-stale",
      order: 1,
      title: "Edit non-existent file",
      objective: "Modify",
      type: "modify",
      dependencies: [],
      riskLevel: "normal",
      verificationRequired: false,
      status: "pending",
      intent: {
        type: "modify_file",
        target: "non_existent_file_xyz_12345.ts",
        reason: "Edit",
        requiresApproval: true,
        estimatedRisk: "normal"
      }
    };

    const staleness = await detectPlanStaleness(plan, step, { cwd: process.cwd() });
    expect(staleness.stale).toBe(true);
    expect(staleness.reason).toContain("does not exist");

    // Plan safely transitions to blocked
    const blockedPlan = transitionPlanStatus(plan, "blocked", staleness.reason);
    expect(blockedPlan.status).toBe("blocked");
  });

  // SCENARIO 6: Workspace changes after approval
  it("Scenario 6: Workspace branch change after approval invalidates checkpoint approval", async () => {
    const cpManager = new DefaultCheckpointManager();
    const record = await cpManager.requestApproval({
      runId: "run-drift-test",
      planId: "plan-drift-test",
      stepId: "step-1",
      stepOrder: 1,
      riskLevel: "elevated",
      reason: "Mutation checkpoint",
      affectedTargets: ["src/index.ts"],
      requiredAction: "modify",
      cwd: process.cwd()
    });

    await cpManager.approve(record.checkpointId, {
      approved: true,
      approvedBy: "user",
      decision: "approved",
      timestamp: Date.now()
    });

    // Simulate branch drift in git repo
    const mockGitDrift: GitRepository = {
      isRepository: async () => true,
      getRoot: async () => process.cwd(),
      getStatus: async (): Promise<GitStatus> => ({
        isRepository: true,
        gitAvailable: true,
        root: process.cwd(),
        branch: "feature/drifted",
        ahead: 0,
        behind: 0,
        hasConflicts: false,
        files: []
      }),
      getBranch: async () => "feature/drifted",
      getSnapshot: async () => ({
        capturedAt: new Date().toISOString(),
        root: process.cwd(),
        branch: "feature/drifted",
        files: []
      })
    };

    const validation = await cpManager.validateApproval(record.checkpointId, {
      runId: "run-drift-test",
      planId: "plan-drift-test",
      stepId: "step-1",
      riskLevel: "elevated",
      cwd: process.cwd(),
      gitRepository: mockGitDrift
    });

    expect(validation.valid).toBe(false);
    expect(validation.status).toBe("invalidated");
    expect(validation.reason).toContain("Git branch changed");
  });

  // SCENARIO 7: Recovery succeeds
  it("Scenario 7: Recovery success leads to explicit continuation decision with eligible steps", async () => {
    const reconciler = new DefaultFinalWorkspaceReconciler();
    const policy = new DefaultTaskRiskPolicy();
    const mockPlanExecutor = {} as PlanExecutor;
    const continuationManager = new DefaultRecoveryContinuationManager({
      planExecutor: mockPlanExecutor,
      reconciler,
      executionPolicy: policy
    });

    const plan = createTaskPlan({
      runId: "run-rec-success",
      userRequestSummary: "Multi-step build",
      objective: "Build feature",
      status: "ready",
      steps: [
        { stepId: "s1", order: 1, title: "Step 1", objective: "Prep", type: "inspect", dependencies: [], riskLevel: "low", verificationRequired: false, status: "completed" },
        { stepId: "s2", order: 2, title: "Step 2", objective: "Build", type: "modify", dependencies: ["s1"], riskLevel: "normal", verificationRequired: true, status: "pending" }
      ]
    });

    const prep = await continuationManager.prepareContinuation(plan, {
      cwd: process.cwd(),
      recoveryOutcome: "recovered"
    });

    expect(prep.eligible).toBe(true);
    expect(prep.canContinue).toBe(true);
    expect(prep.recoveryOutcome).toBe("recovered");
    expect(prep.remainingSteps).toHaveLength(1);
    expect(prep.remainingSteps[0].stepId).toBe("s2");
    expect(prep.requiresExplicitApproval).toBe(true);
  });

  // SCENARIO 8: Recovery remains blocked
  it("Scenario 8: still_blocked recovery outcome forbids automatic continuation", async () => {
    const reconciler = new DefaultFinalWorkspaceReconciler();
    const policy = new DefaultTaskRiskPolicy();
    const mockPlanExecutor = {} as PlanExecutor;
    const continuationManager = new DefaultRecoveryContinuationManager({
      planExecutor: mockPlanExecutor,
      reconciler,
      executionPolicy: policy
    });
    const plan = makePlan();

    const prep = await continuationManager.prepareContinuation(plan, {
      cwd: process.cwd(),
      recoveryOutcome: "still_blocked"
    });

    expect(prep.eligible).toBe(false);
    expect(prep.canContinue).toBe(false);
    expect(prep.reason).toContain("still blocked");
  });

  // SCENARIO 9: Resume failed run
  it("Scenario 9: Resuming a failed run generates a new run ID, links parentRunId, and reassesses risk", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-v1-hist-"));
    const store = new DefaultRunHistoryStore({ storageDir: tmpDir });
    const policy = new DefaultTaskRiskPolicy();
    const resumeManager = new DefaultResumeManager({ historyStore: store, executionPolicy: policy });
    const projectId = await getProjectIdentifier(tmpDir);

    const record: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-failed-original",
      projectId,
      cwd: tmpDir,
      userRequestSummary: "delete all sensitive configuration",
      startedAt: Date.now() - 5000,
      completedAt: Date.now(),
      durationMs: 5000,
      finalStatus: "failed",
      executionState: "interrupted",
      activeSkills: [],
      initialRiskLevel: "critical",
      riskReasons: ["Critical database delete"],
      requiresCheckpoint: true,
      requiresExplicitApproval: true,
      verificationAttempts: 0,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [{ toolName: "delete_file", callId: "c1", startedAt: Date.now() }],
      commands: [],
      recovery: [],
      files: { modified: [], created: [], deleted: ["db.sqlite"] },
      lifecycleTransitions: []
    };

    await store.saveRun(record);

    const prep = await resumeManager.prepareResume("run-failed-original", tmpDir);
    expect(prep.canResume).toBe(true);
    expect(prep.suggestedParentRunId).toBe("run-failed-original");
    expect(prep.newRunId).not.toBe("run-failed-original");
    expect(prep.resumeDepth).toBe(1);
    expect(["elevated", "critical"]).toContain(prep.reassessedRisk.level);

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  // SCENARIO 10: Resume completed run
  it("Scenario 10: Resuming a completed run is safely rejected", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-v1-hist-cmp-"));
    const store = new DefaultRunHistoryStore({ storageDir: tmpDir });
    const policy = new DefaultTaskRiskPolicy();
    const resumeManager = new DefaultResumeManager({ historyStore: store, executionPolicy: policy });
    const projectId = await getProjectIdentifier(tmpDir);

    const record: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-completed-safe",
      projectId,
      cwd: tmpDir,
      userRequestSummary: "Read README.md",
      startedAt: Date.now() - 5000,
      completedAt: Date.now(),
      durationMs: 5000,
      finalStatus: "completed",
      executionState: "completed",
      activeSkills: [],
      initialRiskLevel: "low",
      riskReasons: [],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 0,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [],
      commands: [],
      recovery: [],
      files: { modified: [], created: [], deleted: [] },
      lifecycleTransitions: []
    };

    await store.saveRun(record);

    const prep = await resumeManager.prepareResume("run-completed-safe", tmpDir);
    expect(prep.canResume).toBe(false);
    expect(prep.explanation).toContain("completed successfully and cannot be resumed");

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  // SCENARIO 11: Cancellation during execution
  it("Scenario 11: Cancellation stops active state and transitions directly to cancelled terminal state", () => {
    const sm = new DefaultAgentRunStateMachine();
    sm.transition("planning", "user prompt");
    sm.transition("executing", "plan approved");
    expect(sm.getState()).toBe("executing");

    const cancelResult = sm.transition("cancelled", "User pressed Ctrl+C");
    expect(cancelResult.success).toBe(true);
    expect(sm.getState()).toBe("cancelled");
    expect(sm.isTerminal()).toBe(true);
  });

  // SCENARIO 12: Terminal-state race
  it("Scenario 12: Terminal-state race forbids any post-terminal transition", () => {
    const sm = new DefaultAgentRunStateMachine();
    sm.transition("planning", "start");
    sm.transition("completed", "all steps done");
    expect(sm.isTerminal()).toBe(true);

    const postCompletedTransition = sm.transition("executing", "concurrent retry");
    expect(postCompletedTransition.success).toBe(false);
    expect(postCompletedTransition.error).toContain("terminal state");
  });

  // SCENARIO 13: Checkpoint reuse
  it("Scenario 13: Checkpoint single-use consumption rejects reuse attempts", async () => {
    const manager = new DefaultCheckpointManager();
    const record = await manager.requestApproval({
      runId: "run-single-use",
      planId: "plan-single-use",
      stepId: "step-1",
      stepOrder: 1,
      riskLevel: "elevated",
      reason: "Single use test",
      affectedTargets: ["test.txt"],
      requiredAction: "modify",
      cwd: process.cwd()
    });

    await manager.approve(record.checkpointId, {
      approved: true,
      approvedBy: "user",
      decision: "approved",
      timestamp: Date.now()
    });

    const firstConsume = await manager.consume(record.checkpointId, {
      runId: "run-single-use",
      planId: "plan-single-use",
      stepId: "step-1",
      riskLevel: "elevated",
      cwd: process.cwd()
    });
    expect(firstConsume.success).toBe(true);

    // Second consume attempt MUST fail
    const secondConsume = await manager.consume(record.checkpointId, {
      runId: "run-single-use",
      planId: "plan-single-use",
      stepId: "step-1",
      riskLevel: "elevated",
      cwd: process.cwd()
    });
    expect(secondConsume.success).toBe(false);
    expect(secondConsume.error).toContain("already been consumed");
  });

  // SCENARIO 14: Cross-plan checkpoint reuse
  it("Scenario 14: Cross-plan checkpoint reuse is strictly rejected", async () => {
    const manager = new DefaultCheckpointManager();
    const record = await manager.requestApproval({
      runId: "run-cp",
      planId: "plan-ORIGINAL-A",
      stepId: "step-1",
      stepOrder: 1,
      riskLevel: "elevated",
      reason: "Original plan checkpoint",
      affectedTargets: ["src/code.ts"],
      requiredAction: "modify",
      cwd: process.cwd()
    });

    await manager.approve(record.checkpointId, {
      approved: true,
      approvedBy: "user",
      decision: "approved",
      timestamp: Date.now()
    });

    const crossPlanResult = await manager.consume(record.checkpointId, {
      runId: "run-cp",
      planId: "plan-DIFFERENT-B",
      stepId: "step-1",
      riskLevel: "elevated",
      cwd: process.cwd()
    });

    expect(crossPlanResult.success).toBe(false);
    expect(crossPlanResult.error).toContain("Plan ID mismatch");
  });

  // SCENARIO 15: Cross-run approval reuse
  it("Scenario 15: Cross-run checkpoint approval reuse is rejected", async () => {
    const manager = new DefaultCheckpointManager();
    const record = await manager.requestApproval({
      runId: "run-111",
      planId: "plan-111",
      stepId: "step-1",
      stepOrder: 1,
      riskLevel: "elevated",
      reason: "Run 111 checkpoint",
      affectedTargets: ["src/code.ts"],
      requiredAction: "modify",
      cwd: process.cwd()
    });

    await manager.approve(record.checkpointId, {
      approved: true,
      approvedBy: "user",
      decision: "approved",
      timestamp: Date.now()
    });

    const crossRunResult = await manager.consume(record.checkpointId, {
      runId: "run-222", // Different run ID
      planId: "plan-111",
      stepId: "step-1",
      riskLevel: "elevated",
      cwd: process.cwd()
    });

    expect(crossRunResult.success).toBe(false);
    expect(crossRunResult.error).toContain("Run ID mismatch");
  });

  // SCENARIO 16: Destructive retry
  it("Scenario 16: Destructive operations (delete_file, wipe, purge) are never automatically retried", () => {
    const retryPolicy = new DefaultStepRetryPolicy();
    const destructiveDeleteStep: PlanStep = {
      stepId: "step-del",
      order: 1,
      title: "Delete database file",
      objective: "Remove database",
      type: "modify",
      dependencies: [],
      riskLevel: "critical",
      verificationRequired: false,
      status: "pending",
      intent: {
        type: "delete_file",
        target: "db.sqlite",
        reason: "cleanup",
        requiresApproval: true,
        estimatedRisk: "critical"
      }
    };

    expect(retryPolicy.isDestructive(destructiveDeleteStep)).toBe(true);
    expect(retryPolicy.canRetry(destructiveDeleteStep, 0, "tool_failure")).toBe(false);
    expect(retryPolicy.canRetry(destructiveDeleteStep, 1, "verification_failed")).toBe(false);
  });

  // SCENARIO 17: Malformed CLI input
  it("Scenario 17: Malformed CLI input is handled safely without crashing", () => {
    expect(() => filterCommands("")).not.toThrow();
    expect(() => filterCommands("///")).not.toThrow();
    expect(() => filterCommands("!@#$%^&*()")).not.toThrow();
    expect(() => filterCommands("/nonexistent-command-xyz")).not.toThrow();
    expect(filterCommands("/nonexistent-command-xyz")).toEqual([]);

    const resolver = new InteractiveApprovalResolver();
    expect(() => resolver.submitDecision("invalid-input-gibberish")).not.toThrow();
    expect(() => resolver.cancelPending()).not.toThrow();
  });

  // SCENARIO 18: Missing provider configuration
  it("Scenario 18: Approval resolver defaults safely to deny for missing or empty input", async () => {
    const resolver = new InteractiveApprovalResolver();
    const resolutionPromise = resolver.resolve({
      id: "req-v1-safe",
      toolName: "execute_command",
      category: "execute",
      arguments: { command: "rm -rf /" },
      reason: "Dangerous command"
    });

    // Simulate empty string (pressing enter without typing 'y')
    resolver.submitDecision("");
    const decision = await resolutionPromise;
    expect(decision.approved).toBe(false);
    if (!decision.approved) {
      expect(decision.reason).toContain("denied by the user");
    }
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultExecutionHandoffManager } from "./handoffManager.js";
import { DefaultCheckpointManager } from "../checkpoints/checkpointManager.js";
import { DefaultCheckpointStore } from "../checkpoints/checkpointStore.js";
import { DefaultPlanExecutor } from "./executor.js";
import { createTaskPlan } from "./taskPlan.js";
import { DefaultTaskRiskPolicy } from "../policy/taskRiskPolicy.js";
import {
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultPermissionManager,
  type ApprovalDecision,
  type ApprovalResolver
} from "@fecode/models";
import type { AgentEvent } from "../index.js";

describe("Phase 5AA — Approval-Aware Execution Handoff Integration & Security", () => {
  let tmpDir: string;
  let storeDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-handoff-integ-"));
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-handoff-istore-"));
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "src/index.ts"), "export const x = 1;\n");
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("prevents historical approval from being inherited across resumed or replanned runs", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);

    // Initial run requests and gets approval
    const record = await cpManager.requestApproval({
      runId: "run-original",
      planId: "plan-original",
      stepId: "step-1",
      riskLevel: "elevated",
      reason: "Initial approval",
      affectedTargets: ["src/index.ts"],
      cwd: tmpDir
    });

    await cpManager.approve(record.checkpointId, {
      approved: true,
      approvedBy: "user",
      decision: "approved",
      timestamp: Date.now()
    });

    // 1. Resumed run (new runId) attempts consumption
    const resumeAttempt = await cpManager.consume(record.checkpointId, {
      runId: "run-resumed",
      planId: "plan-original",
      stepId: "step-1",
      riskLevel: "elevated",
      cwd: tmpDir
    });
    expect(resumeAttempt.success).toBe(false);
    expect(resumeAttempt.status).toBe("invalidated");
    expect(resumeAttempt.error).toContain("Run ID mismatch");

    // 2. Replanned plan (new planId) attempts consumption
    const record2 = await cpManager.requestApproval({
      runId: "run-original",
      planId: "plan-original",
      stepId: "step-1",
      riskLevel: "elevated",
      reason: "Initial approval 2",
      affectedTargets: ["src/index.ts"],
      cwd: tmpDir
    });

    await cpManager.approve(record2.checkpointId, {
      approved: true,
      approvedBy: "user",
      decision: "approved",
      timestamp: Date.now()
    });

    const replanAttempt = await cpManager.consume(record2.checkpointId, {
      runId: "run-original",
      planId: "plan-replacement",
      stepId: "step-1",
      riskLevel: "elevated",
      cwd: tmpDir
    });
    expect(replanAttempt.success).toBe(false);
    expect(replanAttempt.status).toBe("invalidated");
    expect(replanAttempt.error).toContain("Plan ID mismatch");
  });

  it("invalidates handoff and stops execution when risk level escalates", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);

    const record = await cpManager.requestApproval({
      runId: "run-escalate",
      planId: "plan-escalate",
      stepId: "step-1",
      riskLevel: "normal",
      reason: "Normal task initially",
      affectedTargets: ["src/index.ts"],
      cwd: tmpDir
    });

    await cpManager.approve(record.checkpointId, {
      approved: true,
      approvedBy: "user",
      decision: "approved",
      timestamp: Date.now()
    });

    // Escalated validation
    const val = await cpManager.validateApproval(record.checkpointId, {
      runId: "run-escalate",
      planId: "plan-escalate",
      stepId: "step-1",
      riskLevel: "critical",
      cwd: tmpDir
    });

    expect(val.valid).toBe(false);
    expect(val.status).toBe("invalidated");
    expect(val.reason).toContain("Risk level escalated");
  });

  it("coordinates handoff through PlanExecutor for multi-step execution", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);
    const riskPolicy = new DefaultTaskRiskPolicy();
    const registry = new DefaultToolRegistry();
    registry.register({
      name: "read_file",
      description: "Read file",
      permissionCategory: "read",
      inputSchema: { type: "object" },
      execute: async () => ({ success: true, output: "content" })
    });
    registry.register({
      name: "edit_file",
      description: "Edit file",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async () => ({ success: true, output: "edited" })
    });
    const toolExecutor = new DefaultToolExecutor(registry);
    const permissionManager = new DefaultPermissionManager();

    const approvalResolver: ApprovalResolver = {
      async resolve(): Promise<ApprovalDecision> {
        return { approved: true };
      }
    };

    const handoffManager = new DefaultExecutionHandoffManager({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager
    });

    const planExecutor = new DefaultPlanExecutor({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager,
      handoffManager
    });

    const plan = createTaskPlan({
      planId: "plan-full-handoff",
      runId: "run-full-handoff",
      userRequestSummary: "Refactor code",
      objective: "Refactor",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Inspect index",
          objective: "Inspect",
          type: "inspect",
          dependencies: [],
          riskLevel: "low",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["src/index.ts"]
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Modify index with elevated risk",
          objective: "Modify",
          type: "modify",
          dependencies: ["step-1"],
          riskLevel: "elevated",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["src/index.ts"],
          intent: {
            type: "modify_file",
            target: "src/index.ts",
            reason: "Modify index",
            requiresApproval: true,
            estimatedRisk: "elevated"
          }
        }
      ]
    });

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-full-handoff",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    expect(events.some((e) => e.type === "execution_handoff_started")).toBe(true);
    expect(events.some((e) => e.type === "execution_handoff_completed")).toBe(true);
    expect(events.some((e) => e.type === "plan_execution_completed")).toBe(true);
  });

  it("enforces single-use checkpoint consumption under concurrent requests", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);

    const record = await cpManager.requestApproval({
      runId: "run-concurrent",
      planId: "plan-concurrent",
      stepId: "step-1",
      riskLevel: "elevated",
      reason: "Concurrent consumption test",
      affectedTargets: ["src/index.ts"],
      cwd: tmpDir
    });

    await cpManager.approve(record.checkpointId, {
      approved: true,
      approvedBy: "user",
      decision: "approved",
      timestamp: Date.now()
    });

    // Launch concurrent consumption attempts
    const [res1, res2] = await Promise.all([
      cpManager.consume(record.checkpointId, {
        runId: "run-concurrent",
        planId: "plan-concurrent",
        stepId: "step-1",
        riskLevel: "elevated",
        cwd: tmpDir
      }),
      cpManager.consume(record.checkpointId, {
        runId: "run-concurrent",
        planId: "plan-concurrent",
        stepId: "step-1",
        riskLevel: "elevated",
        cwd: tmpDir
      })
    ]);

    const successes = [res1, res2].filter((r) => r.success);
    const failures = [res1, res2].filter((r) => !r.success);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].success).toBe(false);
    expect(failures[0].status).toBe("consumed");
  });

  it("enforces strict separation: plan approval does NOT grant checkpoint or tool execution approval", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);
    const riskPolicy = new DefaultTaskRiskPolicy();
    const registry = new DefaultToolRegistry();
    let toolExecuted = false;
    registry.register({
      name: "edit_file",
      description: "Edit file",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async () => {
        toolExecuted = true;
        return { success: true };
      }
    });
    const toolExecutor = new DefaultToolExecutor(registry);
    const permissionManager = new DefaultPermissionManager();

    // User rejects the checkpoint approval even though the plan itself was approved
    const approvalResolver: ApprovalResolver = {
      async resolve(): Promise<ApprovalDecision> {
        return { approved: false, reason: "Checkpoint rejected by user" };
      }
    };

    const handoffManager = new DefaultExecutionHandoffManager({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager
    });

    const planExecutor = new DefaultPlanExecutor({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager,
      handoffManager
    });

    const plan = createTaskPlan({
      planId: "plan-approved-only",
      runId: "run-approved-only",
      userRequestSummary: "Approved plan",
      objective: "Approved plan",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Elevated mutation",
          objective: "Mutate",
          type: "modify",
          dependencies: [],
          riskLevel: "elevated",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["src/index.ts"],
          intent: {
            type: "modify_file",
            target: "src/index.ts",
            reason: "Modify index",
            requiresApproval: true,
            estimatedRisk: "elevated"
          }
        }
      ]
    });

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-approved-only",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    expect(toolExecuted).toBe(false);
    expect(events.some((e) => e.type === "checkpoint_rejected")).toBe(true);
    expect(events.some((e) => e.type === "plan_step_failed")).toBe(true);
  });

  it("ensures continuation after blocked plan reaches handoff and receives fresh validation", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);
    const riskPolicy = new DefaultTaskRiskPolicy();
    const registry = new DefaultToolRegistry();
    let toolExecutionCount = 0;
    registry.register({
      name: "edit_file",
      description: "Edit file",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async () => {
        toolExecutionCount++;
        return { success: true, output: "edited" };
      }
    });
    const toolExecutor = new DefaultToolExecutor(registry);
    const permissionManager = new DefaultPermissionManager();

    const approvalResolver: ApprovalResolver = {
      async resolve(): Promise<ApprovalDecision> {
        return { approved: true };
      }
    };

    const handoffManager = new DefaultExecutionHandoffManager({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager
    });

    const planExecutor = new DefaultPlanExecutor({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager,
      handoffManager
    });

    // Plan with step 1 already completed, step 2 blocked/pending
    const plan = createTaskPlan({
      planId: "plan-continuation",
      runId: "run-continuation",
      userRequestSummary: "Resume execution",
      objective: "Resume",
      status: "blocked",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Step 1 already completed",
          objective: "Completed step",
          type: "inspect",
          dependencies: [],
          riskLevel: "low",
          verificationRequired: false,
          status: "completed",
          expectedFiles: ["src/index.ts"]
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Step 2 continued mutation",
          objective: "Mutation",
          type: "modify",
          dependencies: ["step-1"],
          riskLevel: "elevated",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["src/index.ts"],
          intent: {
            type: "modify_file",
            target: "src/index.ts",
            reason: "Modify index",
            requiresApproval: true,
            estimatedRisk: "elevated"
          }
        }
      ]
    });

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(
      plan,
      {
        runId: "run-continuation",
        cwd: tmpDir
      },
      { isResume: true, resumedFromStepId: "step-2" }
    )) {
      events.push(ev);
    }

    expect(toolExecutionCount).toBe(1);
    expect(events.some((e) => e.type === "execution_resume_started")).toBe(true);
    expect(events.some((e) => e.type === "execution_handoff_started")).toBe(true);
    expect(events.some((e) => e.type === "execution_handoff_approved")).toBe(true);
    expect(events.some((e) => e.type === "execution_handoff_consumed")).toBe(true);
    expect(events.some((e) => e.type === "plan_execution_completed")).toBe(true);
  });

  it("ensures step retry attempts pass through execution handoff on every attempt", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);
    const riskPolicy = new DefaultTaskRiskPolicy();
    const registry = new DefaultToolRegistry();
    let attemptsCount = 0;
    registry.register({
      name: "edit_file",
      description: "Edit file",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async () => {
        attemptsCount++;
        if (attemptsCount === 1) {
          return { success: false, error: new Error("Flaky transient error") };
        }
        return { success: true, output: "succeeded on retry" };
      }
    });
    const toolExecutor = new DefaultToolExecutor(registry);
    const permissionManager = new DefaultPermissionManager();

    const approvalResolver: ApprovalResolver = {
      async resolve(): Promise<ApprovalDecision> {
        return { approved: true };
      }
    };

    const handoffManager = new DefaultExecutionHandoffManager({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager
    });

    const planExecutor = new DefaultPlanExecutor({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager,
      handoffManager
    });

    const plan = createTaskPlan({
      planId: "plan-retry",
      runId: "run-retry",
      userRequestSummary: "Retry test",
      objective: "Retry test",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Retryable modification",
          objective: "Modify with retry",
          type: "modify",
          dependencies: [],
          riskLevel: "elevated",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["src/index.ts"],
          intent: {
            type: "modify_file",
            target: "src/index.ts",
            reason: "Modify index with retry",
            requiresApproval: true,
            estimatedRisk: "elevated"
          }
        }
      ]
    });

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-retry",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    expect(attemptsCount).toBe(2);
    const handoffStartedEvents = events.filter(
      (e) => e.type === "execution_handoff_started"
    );
    expect(handoffStartedEvents.length).toBe(2);
    expect(events.some((e) => e.type === "step_retry_started")).toBe(true);
    expect(events.some((e) => e.type === "step_retry_completed")).toBe(true);
    expect(events.some((e) => e.type === "plan_execution_completed")).toBe(true);
  });

  it("ensures recovery continuation strictly routes through handoff boundary", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);
    const riskPolicy = new DefaultTaskRiskPolicy();
    const registry = new DefaultToolRegistry();
    let handoffExecuted = false;
    registry.register({
      name: "edit_file",
      description: "Edit file",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async () => {
        handoffExecuted = true;
        return { success: true, output: "recovered step executed" };
      }
    });
    const toolExecutor = new DefaultToolExecutor(registry);
    const permissionManager = new DefaultPermissionManager();

    const approvalResolver: ApprovalResolver = {
      async resolve(): Promise<ApprovalDecision> {
        return { approved: true };
      }
    };

    const handoffManager = new DefaultExecutionHandoffManager({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager
    });

    const planExecutor = new DefaultPlanExecutor({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager,
      handoffManager
    });

    const { DefaultFinalWorkspaceReconciler } = await import("./reconciliation.js");
    const reconciler = new DefaultFinalWorkspaceReconciler();

    const { DefaultRecoveryContinuationManager } = await import("./continuationManager.js");
    const continuationManager = new DefaultRecoveryContinuationManager({
      planExecutor,
      reconciler,
      executionPolicy: riskPolicy,
      permissionManager,
      approvalResolver,
      checkpointManager: cpManager
    });

    const plan = createTaskPlan({
      planId: "plan-rec-cont",
      runId: "run-rec-cont",
      userRequestSummary: "Recovery continuation test",
      objective: "Recovery continuation",
      status: "blocked",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Step 1 completed",
          objective: "Completed",
          type: "inspect",
          dependencies: [],
          riskLevel: "low",
          verificationRequired: false,
          status: "completed",
          expectedFiles: ["src/index.ts"]
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Step 2 continued via recovery",
          objective: "Recovery step",
          type: "modify",
          dependencies: ["step-1"],
          riskLevel: "elevated",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["src/index.ts"],
          intent: {
            type: "modify_file",
            target: "src/index.ts",
            reason: "Modify index via recovery",
            requiresApproval: true,
            estimatedRisk: "elevated"
          }
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
      runId: "run-rec-cont",
      planId: "plan-rec-cont",
      decision: "continue",
      approved: true,
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    expect(handoffExecuted).toBe(true);
    expect(events.some((e) => e.type === "recovery_continuation_started")).toBe(true);
    expect(events.some((e) => e.type === "execution_handoff_started")).toBe(true);
    expect(events.some((e) => e.type === "execution_handoff_consumed")).toBe(true);
    expect(events.some((e) => e.type === "recovery_continuation_completed")).toBe(true);
  });

  it("ensures continuation approval for step 1 does NOT authorize step 2 without its own checkpoint approval", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);
    const riskPolicy = new DefaultTaskRiskPolicy();
    const registry = new DefaultToolRegistry();
    let step2Executed = false;
    registry.register({
      name: "edit_file",
      description: "Edit file",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async (args) => {
        if ((args as { path?: string })?.path === "src/step2.ts") {
          step2Executed = true;
        }
        return { success: true, output: "edited" };
      }
    });
    const toolExecutor = new DefaultToolExecutor(registry);
    const permissionManager = new DefaultPermissionManager();

    // User approves step 1, but rejects step 2
    const approvalResolver: ApprovalResolver = {
      async resolve(req): Promise<ApprovalDecision> {
        const args = req.arguments as Record<string, unknown> | undefined;
        if (
          req.id?.includes("step-1") ||
          args?.stepId === "step-1" ||
          args?.path === "src/step1.ts"
        ) {
          return { approved: true };
        }
        return { approved: false, reason: "Step 2 approval denied by user" };
      }
    };

    const handoffManager = new DefaultExecutionHandoffManager({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager
    });

    const planExecutor = new DefaultPlanExecutor({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager,
      handoffManager
    });

    await fs.writeFile(path.join(tmpDir, "src/step1.ts"), "step 1\n");
    await fs.writeFile(path.join(tmpDir, "src/step2.ts"), "step 2\n");

    const plan = createTaskPlan({
      planId: "plan-isolation-steps",
      runId: "run-isolation-steps",
      userRequestSummary: "Step isolation test",
      objective: "Step isolation",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Step 1 mutation",
          objective: "Step 1",
          type: "modify",
          dependencies: [],
          riskLevel: "elevated",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["src/step1.ts"],
          intent: {
            type: "modify_file",
            target: "src/step1.ts",
            reason: "Modify step 1",
            requiresApproval: true,
            estimatedRisk: "elevated"
          }
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Step 2 mutation",
          objective: "Step 2",
          type: "modify",
          dependencies: ["step-1"],
          riskLevel: "elevated",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["src/step2.ts"],
          intent: {
            type: "modify_file",
            target: "src/step2.ts",
            reason: "Modify step 2",
            requiresApproval: true,
            estimatedRisk: "elevated"
          }
        }
      ]
    });

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-isolation-steps",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    expect(step2Executed).toBe(false);
    expect(events.some((e) => e.type === "plan_step_completed" && e.stepId === "step-1")).toBe(true);
    expect(events.some((e) => e.type === "execution_handoff_rejected" && e.stepId === "step-2")).toBe(true);
    expect(events.some((e) => e.type === "plan_blocked")).toBe(true);
  });

  it("invalidates checkpoint approval when git branch changes prior to consumption", async () => {
    const store = new DefaultCheckpointStore(storeDir);

    let currentBranch = "feature/initial";
    const mockRunner = async (args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return { stdout: `${currentBranch}\n`, stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const { DefaultGitRepository } = await import("../git/gitRepository.js");
    const gitRepo = new DefaultGitRepository(mockRunner);
    const cpManager = new DefaultCheckpointManager(store, gitRepo);

    // Request and approve on feature/initial
    const record = await cpManager.requestApproval({
      runId: "run-branch-drift",
      planId: "plan-branch-drift",
      stepId: "step-1",
      riskLevel: "elevated",
      reason: "Branch drift test",
      affectedTargets: ["src/index.ts"],
      cwd: tmpDir
    });

    await cpManager.approve(record.checkpointId, {
      approved: true,
      approvedBy: "user",
      decision: "approved",
      timestamp: Date.now()
    });

    // Branch switches before consumption
    currentBranch = "main";

    const consumeRes = await cpManager.consume(record.checkpointId, {
      runId: "run-branch-drift",
      planId: "plan-branch-drift",
      stepId: "step-1",
      riskLevel: "elevated",
      cwd: tmpDir,
      gitRepository: gitRepo
    });

    expect(consumeRes.success).toBe(false);
    expect(consumeRes.status).toBe("invalidated");
    expect(consumeRes.error).toContain("Git branch changed");
  });

  it("safely handles cancellation race before tool execution", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);
    const riskPolicy = new DefaultTaskRiskPolicy();
    const registry = new DefaultToolRegistry();
    let toolExecuted = false;
    registry.register({
      name: "edit_file",
      description: "Edit file",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async () => {
        toolExecuted = true;
        return { success: true };
      }
    });
    const toolExecutor = new DefaultToolExecutor(registry);
    const permissionManager = new DefaultPermissionManager();

    const controller = new AbortController();

    const approvalResolver: ApprovalResolver = {
      async resolve(): Promise<ApprovalDecision> {
        // Abort right during approval resolution
        controller.abort();
        return { approved: true };
      }
    };

    const handoffManager = new DefaultExecutionHandoffManager({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager
    });

    const events: AgentEvent[] = [];
    const gen = handoffManager.executeHandoff({
      runId: "run-abort-race",
      planId: "plan-abort-race",
      cwd: tmpDir,
      signal: controller.signal,
      step: {
        stepId: "step-1",
        order: 1,
        title: "Edit index under race",
        objective: "Edit",
        type: "modify",
        dependencies: [],
        riskLevel: "elevated",
        verificationRequired: false,
        status: "pending",
        expectedFiles: ["src/index.ts"],
        intent: {
          type: "modify_file",
          target: "src/index.ts",
          reason: "Modify index",
          requiresApproval: true,
          estimatedRisk: "elevated"
        }
      }
    });

    let result = await gen.next();
    while (!result.done) {
      events.push(result.value);
      result = await gen.next();
    }

    expect(toolExecuted).toBe(false);
    expect(result.value.status).toBe("cancelled");
  });
});

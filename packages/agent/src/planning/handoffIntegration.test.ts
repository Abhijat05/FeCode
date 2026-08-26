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
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultCheckpointManager } from "./checkpointManager.js";
import { DefaultCheckpointStore } from "./checkpointStore.js";
import { DefaultPlanExecutor } from "../planning/executor.js";
import { createTaskPlan } from "../planning/taskPlan.js";
import { DefaultTaskRiskPolicy } from "../policy/taskRiskPolicy.js";
import {
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultPermissionManager,
  type ApprovalDecision,
  type ApprovalResolver
} from "@fecode/models";
import type { AgentEvent } from "../index.js";

describe("Phase 5Y — Checkpoint Continuity & Approval Lifecycle Integration", () => {
  let tmpDir: string;
  let storeDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-cp-integ-"));
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-cp-store-"));
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "src/auth.ts"), "export const auth = true;\n");
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("enforces checkpoint creation, approval request, and consumption on elevated mutating steps", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);
    const riskPolicy = new DefaultTaskRiskPolicy();
    const registry = new DefaultToolRegistry();
    registry.register({
      name: "edit_file",
      description: "Edit file",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async () => ({ success: true, output: "modified" })
    });
    const toolExecutor = new DefaultToolExecutor(registry);
    const permissionManager = new DefaultPermissionManager();

    const approvalResolver: ApprovalResolver = {
      async resolve(): Promise<ApprovalDecision> {
        return {
          approved: true
        };
      }
    };

    const planExecutor = new DefaultPlanExecutor({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager
    });

    const plan = createTaskPlan({
      planId: "plan-cp-1",
      runId: "run-cp-1",
      userRequestSummary: "Update auth config",
      objective: "Elevated change",
      status: "approved",
      steps: [
        {
          stepId: "step-elevated-1",
          order: 1,
          title: "Modify auth file",
          objective: "Modify auth",
          type: "modify",
          dependencies: [],
          riskLevel: "elevated",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["src/auth.ts"],
          intent: {
            type: "modify_file",
            target: "src/auth.ts",
            reason: "Update auth config",
            requiresApproval: true,
            estimatedRisk: "elevated"
          }
        }
      ]
    });

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-cp-1",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const createdEv = events.find((e) => e.type === "checkpoint_created");
    expect(createdEv).toBeDefined();

    const requestedEv = events.find((e) => e.type === "checkpoint_approval_requested");
    expect(requestedEv).toBeDefined();

    const approvedEv = events.find((e) => e.type === "checkpoint_approved");
    expect(approvedEv).toBeDefined();

    const consumedEv = events.find((e) => e.type === "checkpoint_consumed");
    expect(consumedEv).toBeDefined();

    const records = await cpManager.listRecords({ runId: "run-cp-1" });
    expect(records.length).toBe(1);
    expect(records[0].status).toBe("consumed");
    expect(records[0].consumedAt).toBeDefined();
  });

  it("aborts execution cleanly when checkpoint approval is rejected by user", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);
    const riskPolicy = new DefaultTaskRiskPolicy();
    const registry = new DefaultToolRegistry();
    registry.register({
      name: "edit_file",
      description: "Edit file",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async () => ({ success: true, output: "modified" })
    });
    const toolExecutor = new DefaultToolExecutor(registry);
    const permissionManager = new DefaultPermissionManager();

    const approvalResolver: ApprovalResolver = {
      async resolve(): Promise<ApprovalDecision> {
        return {
          approved: false,
          reason: "User denied elevated mutation"
        };
      }
    };

    const planExecutor = new DefaultPlanExecutor({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager
    });

    const plan = createTaskPlan({
      planId: "plan-cp-2",
      runId: "run-cp-2",
      userRequestSummary: "Drop database table",
      objective: "Critical change",
      status: "approved",
      steps: [
        {
          stepId: "step-crit-1",
          order: 1,
          title: "Delete critical data",
          objective: "Delete",
          type: "modify",
          dependencies: [],
          riskLevel: "critical",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["src/auth.ts"]
        }
      ]
    });

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-cp-2",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const rejectedEv = events.find((e) => e.type === "checkpoint_rejected");
    expect(rejectedEv).toBeDefined();

    const records = await cpManager.listRecords({ runId: "run-cp-2" });
    expect(records.length).toBe(1);
    expect(records[0].status).toBe("rejected");
    expect(records[0].invalidationReason).toContain("User denied elevated mutation");
  });

  it("prevents single approval from being reused across different run or plan identities", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);

    const record = await cpManager.requestApproval({
      runId: "run-original",
      planId: "plan-original",
      stepId: "step-1",
      riskLevel: "elevated",
      reason: "Initial run approval",
      affectedTargets: ["src/auth.ts"],
      cwd: tmpDir
    });

    await cpManager.approve(record.checkpointId, {
      approved: true,
      approvedBy: "user",
      decision: "approved",
      timestamp: Date.now()
    });

    // Attempt consumption in a resumed or continuation run with new runId
    const resumedAttempt = await cpManager.consume(record.checkpointId, {
      runId: "run-resumed",
      planId: "plan-original",
      stepId: "step-1",
      riskLevel: "elevated",
      cwd: tmpDir
    });

    expect(resumedAttempt.success).toBe(false);
    expect(resumedAttempt.status).toBe("invalidated");
    expect(resumedAttempt.error).toContain("Run ID mismatch");
  });
});

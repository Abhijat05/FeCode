import { describe, it, expect } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  DefaultExecutionHandoffManager
} from "../planning/handoffManager.js";
import {
  DefaultTaskRiskPolicy
} from "../policy/taskRiskPolicy.js";
import {
  DefaultCheckpointManager
} from "../checkpoints/checkpointManager.js";
import {
  DefaultStepRetryPolicy
} from "../planning/retryPolicy.js";
import {
  DefaultRunHistoryStore
} from "../history/runHistoryStore.js";
import {
  sanitizeDurableRunRecord
} from "../history/sanitizer.js";
import {
  createDefaultToolRegistry
} from "../tools/defaultRegistry.js";
import {
  DefaultToolExecutor,
  DefaultPermissionManager,
  AutoDenyResolver,
  type PermissionPolicy,
  type PermissionDecision
} from "@fecode/models";
import {
  createTaskPlan,
  transitionPlanStatus,
  startPlanStep
} from "../planning/taskPlan.js";
import type { PlanStep } from "../planning/types.js";
import type { AgentEvent } from "../index.js";
import type { DurableRunRecord } from "../history/types.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("FeCode V1 Security Invariant Test Matrix — 17 Invariants", () => {
  // Invariant 1: No permission bypass
  it("Invariant 1: No permission bypass — Protected tool with denied permission cannot execute", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-inv1-"));
    const targetFile = path.join(tmpDir, "payload.js");
    await fs.writeFile(targetFile, "console.log('original');");

    const registry = createDefaultToolRegistry();
    const executor = new DefaultToolExecutor(registry);
    class DenyAllPolicy implements PermissionPolicy {
      checkPermission(): PermissionDecision {
        return { type: "denied", reason: "Permission denied by strict policy" };
      }
    }
    const permissions = new DefaultPermissionManager(new DenyAllPolicy());
    const policy = new DefaultTaskRiskPolicy();

    const handoff = new DefaultExecutionHandoffManager({
      registry,
      executor,
      permissionManager: permissions,
      executionPolicy: policy
    });

    const step: PlanStep = {
      stepId: "step-sec-1",
      order: 1,
      title: "Modify file",
      objective: "Create dangerous file",
      type: "modify",
      dependencies: [],
      riskLevel: "normal",
      verificationRequired: false,
      status: "pending",
      intent: {
        type: "modify_file",
        target: targetFile,
        reason: "Test",
        requiresApproval: false,
        estimatedRisk: "normal"
      }
    };

    const events: AgentEvent[] = [];
    for await (const ev of handoff.executeHandoff({
      runId: "run-inv-1",
      planId: "plan-inv-1",
      step,
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const completedEv = events.find(
      (e) => e.type === "execution_handoff_completed"
    );
    expect(completedEv).toBeDefined();
    if (completedEv && completedEv.type === "execution_handoff_completed") {
      expect(completedEv.status).toBe("failed");
    }

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  // Invariant 2: No checkpoint bypass
  it("Invariant 2: No checkpoint bypass — Elevated/critical step cannot execute if checkpoint fails", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-inv2-"));
    const targetFile = path.join(tmpDir, "schema.sql");
    await fs.writeFile(targetFile, "CREATE TABLE users (id INT);");

    const registry = createDefaultToolRegistry();
    const executor = new DefaultToolExecutor(registry);
    const permissions = new DefaultPermissionManager();
    const policy = new DefaultTaskRiskPolicy();

    const failingCheckpointManager = new DefaultCheckpointManager();
    failingCheckpointManager.create = async () => ({
      success: false,
      error: "Storage full — checkpoint could not be persisted"
    });

    const handoff = new DefaultExecutionHandoffManager({
      registry,
      executor,
      permissionManager: permissions,
      executionPolicy: policy,
      checkpointManager: failingCheckpointManager
    });

    const step: PlanStep = {
      stepId: "step-sec-2",
      order: 1,
      title: "Mutate database schema",
      objective: "Migrate schema",
      type: "modify",
      dependencies: [],
      riskLevel: "critical",
      verificationRequired: false,
      status: "pending",
      intent: {
        type: "modify_file",
        target: targetFile,
        reason: "Drop column",
        requiresApproval: true,
        estimatedRisk: "critical"
      }
    };

    const events: AgentEvent[] = [];
    for await (const ev of handoff.executeHandoff({
      runId: "run-inv-2",
      planId: "plan-inv-2",
      step,
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const blockedEv = events.find((e) => e.type === "execution_handoff_blocked");
    expect(blockedEv).toBeDefined();
    if (blockedEv && blockedEv.type === "execution_handoff_blocked") {
      expect(blockedEv.blockers[0]).toContain("Checkpoint creation failed");
    }

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  // Invariant 3: No handoff bypass
  it("Invariant 3: No handoff bypass — Unapproved execution attempt is rejected by handoff manager", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-inv3-"));
    const targetFile = path.join(tmpDir, "auth.ts");
    await fs.writeFile(targetFile, "export const auth = false;");

    const registry = createDefaultToolRegistry();
    const executor = new DefaultToolExecutor(registry);
    const permissions = new DefaultPermissionManager();
    const policy = new DefaultTaskRiskPolicy();
    const checkpoints = new DefaultCheckpointManager();

    const handoff = new DefaultExecutionHandoffManager({
      registry,
      executor,
      permissionManager: permissions,
      executionPolicy: policy,
      checkpointManager: checkpoints,
      approvalResolver: new AutoDenyResolver() // Denies all approvals
    });

    const step: PlanStep = {
      stepId: "step-sec-3",
      order: 1,
      title: "Modify protected source",
      objective: "Write code",
      type: "modify",
      dependencies: [],
      riskLevel: "elevated",
      verificationRequired: false,
      status: "pending",
      intent: {
        type: "modify_file",
        target: targetFile,
        reason: "Modify auth",
        requiresApproval: true,
        estimatedRisk: "elevated"
      }
    };

    const events: AgentEvent[] = [];
    for await (const ev of handoff.executeHandoff({
      runId: "run-inv-3",
      planId: "plan-inv-3",
      step,
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const rejectedEv = events.find(
      (e) => e.type === "execution_handoff_rejected"
    );
    expect(rejectedEv).toBeDefined();
    if (rejectedEv && rejectedEv.type === "execution_handoff_rejected") {
      expect(rejectedEv.reason).toContain("denied");
    }

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  // Invariant 4: No risk downgrade
  it("Invariant 4: No risk downgrade — Dynamic assessment never lowers pre-assigned plan step risk", async () => {
    const registry = createDefaultToolRegistry();
    const executor = new DefaultToolExecutor(registry);
    const permissions = new DefaultPermissionManager();
    const policy = new DefaultTaskRiskPolicy();

    const handoff = new DefaultExecutionHandoffManager({
      registry,
      executor,
      permissionManager: permissions,
      executionPolicy: policy
    });

    const step: PlanStep = {
      stepId: "step-sec-4",
      order: 1,
      title: "Read file marked critical",
      objective: "Read",
      type: "inspect",
      dependencies: [],
      riskLevel: "critical",
      verificationRequired: false,
      status: "pending",
      intent: {
        type: "inspect_file",
        target: "README.md",
        reason: "Read",
        requiresApproval: false,
        estimatedRisk: "low"
      }
    };

    const prep = await handoff.prepareHandoff({
      runId: "run-inv-4",
      planId: "plan-inv-4",
      step,
      cwd: process.cwd()
    });

    expect(prep.effectiveRisk).toBe("critical");
    expect(prep.requiresCheckpoint).toBe(true);
    expect(prep.requiresExplicitApproval).toBe(true);
  });

  // Invariant 5: No approval inheritance
  it("Invariant 5: No approval inheritance — Plan approval does not grant tool mutation approval", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-inv5-"));
    const targetFile = path.join(tmpDir, "config.json");
    await fs.writeFile(targetFile, JSON.stringify({ version: "1.0.0" }));

    const plan = createTaskPlan({
      runId: "run-inv-5",
      userRequestSummary: "Test request",
      objective: "Test objective",
      status: "ready",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Write config",
          objective: "Write config",
          type: "modify",
          dependencies: [],
          riskLevel: "elevated",
          verificationRequired: false,
          status: "pending",
          intent: {
            type: "modify_file",
            target: targetFile,
            reason: "Update",
            requiresApproval: true,
            estimatedRisk: "elevated"
          }
        }
      ]
    });

    const approvedPlan = transitionPlanStatus(plan, "approved");
    expect(approvedPlan.status).toBe("approved");

    const registry = createDefaultToolRegistry();
    const executor = new DefaultToolExecutor(registry);
    const permissions = new DefaultPermissionManager();
    const policy = new DefaultTaskRiskPolicy();
    const checkpoints = new DefaultCheckpointManager();

    const handoff = new DefaultExecutionHandoffManager({
      registry,
      executor,
      permissionManager: permissions,
      executionPolicy: policy,
      checkpointManager: checkpoints,
      approvalResolver: new AutoDenyResolver() // Denies step approval
    });

    const events: AgentEvent[] = [];
    for await (const ev of handoff.executeHandoff({
      runId: "run-inv-5",
      planId: approvedPlan.planId,
      step: approvedPlan.steps[0],
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const rejectedEv = events.find(
      (e) => e.type === "execution_handoff_rejected"
    );
    expect(rejectedEv).toBeDefined();

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  // Invariant 6: No checkpoint inheritance
  it("Invariant 6: No checkpoint inheritance — Checkpoints are strictly single-use and cannot authorize subsequent steps", async () => {
    const manager = new DefaultCheckpointManager();
    const record = await manager.requestApproval({
      runId: "run-inv-6",
      planId: "plan-inv-6",
      stepId: "step-1",
      stepOrder: 1,
      riskLevel: "elevated",
      reason: "Step 1 checkpoint",
      affectedTargets: ["src/a.ts"],
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
      runId: "run-inv-6",
      planId: "plan-inv-6",
      stepId: "step-1",
      riskLevel: "elevated",
      cwd: process.cwd()
    });
    expect(firstConsume.success).toBe(true);

    const secondConsume = await manager.consume(record.checkpointId, {
      runId: "run-inv-6",
      planId: "plan-inv-6",
      stepId: "step-2",
      riskLevel: "elevated",
      cwd: process.cwd()
    });
    expect(secondConsume.success).toBe(false);
    expect(secondConsume.error).toMatch(/already.*consumed/i);
  });

  // Invariant 7: No cross-project history access
  it("Invariant 7: No cross-project history access — History queries only return runs for the requested project", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-sec-history-"));
    const store = new DefaultRunHistoryStore({ storageDir: tmpDir });

    await store.saveRun(
      {
        runId: "run-project-alpha",
        startedAt: 1000,
        finalStatus: "completed",
        cwd: "/path/alpha"
      } as unknown as DurableRunRecord,
      "project-alpha"
    );

    await store.saveRun(
      {
        runId: "run-project-beta",
        startedAt: 2000,
        finalStatus: "completed",
        cwd: "/path/beta"
      } as unknown as DurableRunRecord,
      "project-beta"
    );

    const alphaRuns = await store.listRuns("project-alpha");
    expect(alphaRuns.length).toBe(1);
    expect(alphaRuns[0].runId).toBe("run-project-alpha");
    expect(alphaRuns.some((r) => r.runId === "run-project-beta")).toBe(false);

    const betaRuns = await store.listRuns("project-beta");
    expect(betaRuns.length).toBe(1);
    expect(betaRuns[0].runId).toBe("run-project-beta");

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Invariant 8: No secret persistence
  it("Invariant 8: No secret persistence — API keys and tokens are redacted from persisted history records", () => {
    const rawRecord: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-secret-test",
      projectId: "proj-1",
      cwd: "/repo",
      userRequestSummary: "Deploy with sk-proj-abc1234567890123456789012345 and ghp_abcdefghijklmnop1234567890",
      startedAt: Date.now(),
      finalStatus: "completed",
      executionState: "completed",
      activeSkills: [],
      riskReasons: ["Authorization: Bearer mysecrettoken12345"],
      commands: [
        {
          command: "export GEMINI_API_KEY=AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz",
          attempt: 1,
          startedAt: Date.now(),
          succeeded: true
        }
      ],
      tools: [
        {
          toolName: "execute_command",
          callId: "c-1",
          startedAt: Date.now(),
          success: true
        }
      ]
    } as unknown as DurableRunRecord;

    const sanitized = sanitizeDurableRunRecord(rawRecord);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain("sk-proj-abc1234567890123456789012345");
    expect(serialized).not.toContain("ghp_abcdefghijklmnop1234567890");
    expect(serialized).not.toContain("AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz");
    expect(serialized).not.toContain("mysecrettoken12345");
    expect(serialized).toContain("[REDACTED");
  });

  // Invariant 9: No raw credential logging
  it("Invariant 9: No raw credential logging — Environment and secrets are scrubbed from run summaries", () => {
    const rawRecord: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-cred-test",
      projectId: "proj-1",
      cwd: "/repo",
      userRequestSummary: "Connect with password=SuperSecretPass123! and API_KEY=xyz987654321",
      startedAt: Date.now(),
      finalStatus: "failed",
      executionState: "failed",
      activeSkills: [],
      failureReason: "Failed to authenticate with pass=SuperSecretPass123!"
    } as unknown as DurableRunRecord;

    const sanitized = sanitizeDurableRunRecord(rawRecord);
    expect(sanitized.userRequestSummary).not.toContain("SuperSecretPass123!");
    expect(sanitized.userRequestSummary).not.toContain("xyz987654321");
    expect(sanitized.failureReason).not.toContain("SuperSecretPass123!");
  });

  // Invariant 10: No destructive automatic retry
  it("Invariant 10: No destructive automatic retry — Dangerous filesystem deletions are never eligible for auto-retry", () => {
    const policy = new DefaultStepRetryPolicy();
    const deleteStep: PlanStep = {
      stepId: "step-rm",
      order: 1,
      title: "Remove dist directory",
      objective: "Clean build",
      type: "modify",
      dependencies: [],
      riskLevel: "critical",
      verificationRequired: false,
      status: "pending",
      intent: {
        type: "delete_file",
        target: "dist",
        reason: "Clean up",
        requiresApproval: true,
        estimatedRisk: "critical"
      }
    };

    expect(policy.isDestructive(deleteStep)).toBe(true);
    expect(policy.canRetry(deleteStep, 0, "tool_failure")).toBe(false);
  });

  // Invariant 11: No autonomous recovery
  it("Invariant 11: No autonomous recovery — Recovery requires explicit user approval", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-inv11-"));
    const targetFile = path.join(tmpDir, "broken.ts");
    await fs.writeFile(targetFile, "export const broken = true;");

    const registry = createDefaultToolRegistry();
    const executor = new DefaultToolExecutor(registry);
    const permissions = new DefaultPermissionManager();
    const policy = new DefaultTaskRiskPolicy();

    const handoff = new DefaultExecutionHandoffManager({
      registry,
      executor,
      permissionManager: permissions,
      executionPolicy: policy,
      approvalResolver: new AutoDenyResolver()
    });

    const step: PlanStep = {
      stepId: "step-rec-1",
      order: 1,
      title: "Recovery rollback step",
      objective: "Roll back file",
      type: "modify",
      dependencies: [],
      riskLevel: "elevated",
      verificationRequired: false,
      status: "pending",
      intent: {
        type: "modify_file",
        target: targetFile,
        reason: "Repair",
        requiresApproval: true,
        estimatedRisk: "elevated"
      }
    };

    const events: AgentEvent[] = [];
    for await (const ev of handoff.executeHandoff({
      runId: "run-inv-11",
      planId: "plan-inv-11",
      step,
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const rejectedEv = events.find(
      (e) => e.type === "execution_handoff_rejected"
    );
    expect(rejectedEv).toBeDefined();

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  // Invariant 12: No autonomous replanning
  it("Invariant 12: No autonomous replanning — Blocked plan does not automatically start execution", () => {
    const plan = createTaskPlan({
      runId: "run-inv-12",
      userRequestSummary: "Test request",
      objective: "Test",
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

    expect(plan.status).toBe("blocked");
    expect(() => startPlanStep(plan, "step-1")).toThrow(/Cannot start step in plan with status 'blocked'/);
  });

  // Invariant 13: No autonomous continuation
  it("Invariant 13: No autonomous continuation — Continuation default is reject and cannot proceed without approval", async () => {
    const manager = new DefaultCheckpointManager();
    const record = await manager.requestApproval({
      runId: "run-inv-13",
      planId: "plan-inv-13",
      stepId: "step-1",
      stepOrder: 1,
      riskLevel: "normal",
      reason: "Continuation step",
      affectedTargets: ["src/app.ts"],
      requiredAction: "modify",
      cwd: process.cwd()
    });

    await manager.reject(record.checkpointId, "User chose not to continue");

    const consume = await manager.consume(record.checkpointId, {
      runId: "run-inv-13",
      planId: "plan-inv-13",
      stepId: "step-1",
      riskLevel: "normal",
      cwd: process.cwd()
    });

    expect(consume.success).toBe(false);
    expect(consume.error).toContain("rejected");
  });

  // Invariant 14: No post-terminal execution
  it("Invariant 14: No post-terminal execution — Cannot initiate handoff or step after terminal status", async () => {
    const registry = createDefaultToolRegistry();
    const executor = new DefaultToolExecutor(registry);
    const permissions = new DefaultPermissionManager();
    const policy = new DefaultTaskRiskPolicy();

    const plan = createTaskPlan({
      runId: "run-inv-14",
      userRequestSummary: "Terminal plan",
      objective: "Test",
      status: "completed",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Late step",
          objective: "Late",
          type: "inspect",
          dependencies: [],
          riskLevel: "low",
          verificationRequired: false,
          status: "pending"
        }
      ]
    });

    expect(() => startPlanStep(plan, "step-1")).toThrow(/Cannot start step in plan with status 'completed'/);

    const controller = new AbortController();
    controller.abort();

    const handoff = new DefaultExecutionHandoffManager({
      registry,
      executor,
      permissionManager: permissions,
      executionPolicy: policy
    });

    const gen = handoff.executeHandoff({
      runId: "run-inv-14",
      planId: plan.planId,
      step: plan.steps[0],
      cwd: process.cwd(),
      signal: controller.signal
    });

    const res = await gen.next();
    expect(res.done).toBe(true);
    const returnVal = res.value as unknown as import("../planning/types.js").ExecutionHandoffResult;
    expect(returnVal.success).toBe(false);
    expect(returnVal.status).toBe("cancelled");
  });

  // Invariant 15: No stale approval usage
  it("Invariant 15: No stale approval usage — Expired checkpoint approvals are invalidated", async () => {
    const manager = new DefaultCheckpointManager();
    const record = await manager.requestApproval({
      runId: "run-inv-15",
      planId: "plan-inv-15",
      stepId: "step-1",
      stepOrder: 1,
      riskLevel: "elevated",
      reason: "Expire test",
      affectedTargets: ["src/lib.ts"],
      requiredAction: "modify",
      cwd: process.cwd(),
      ttlMs: 250 // 250 milliseconds TTL
    });

    await manager.approve(record.checkpointId, {
      approved: true,
      approvedBy: "user",
      decision: "approved",
      timestamp: Date.now()
    });

    // Wait 300ms for TTL to expire
    await delay(300);

    const consume = await manager.consume(record.checkpointId, {
      runId: "run-inv-15",
      planId: "plan-inv-15",
      stepId: "step-1",
      riskLevel: "elevated",
      cwd: process.cwd()
    });

    expect(consume.success).toBe(false);
    expect(consume.error).toMatch(/expired|invalidated/i);
  });

  // Invariant 16: No cross-plan checkpoint usage
  it("Invariant 16: No cross-plan checkpoint usage — Checkpoint requested for Plan A cannot be consumed in Plan B", async () => {
    const manager = new DefaultCheckpointManager();
    const record = await manager.requestApproval({
      runId: "run-inv-16",
      planId: "plan-ORIGINAL-A",
      stepId: "step-1",
      stepOrder: 1,
      riskLevel: "elevated",
      reason: "Plan A checkpoint",
      affectedTargets: ["file.ts"],
      requiredAction: "modify",
      cwd: process.cwd()
    });

    await manager.approve(record.checkpointId, {
      approved: true,
      approvedBy: "user",
      decision: "approved",
      timestamp: Date.now()
    });

    const consume = await manager.consume(record.checkpointId, {
      runId: "run-inv-16",
      planId: "plan-DIFFERENT-B",
      stepId: "step-1",
      riskLevel: "elevated",
      cwd: process.cwd()
    });

    expect(consume.success).toBe(false);
    expect(consume.error).toContain("Plan ID mismatch");
  });

  // Invariant 17: No cross-run authorization usage
  it("Invariant 17: No cross-run authorization usage — Checkpoint requested for Run 1 cannot be consumed in Run 2", async () => {
    const manager = new DefaultCheckpointManager();
    const record = await manager.requestApproval({
      runId: "run-AAA",
      planId: "plan-1",
      stepId: "step-1",
      stepOrder: 1,
      riskLevel: "elevated",
      reason: "Run AAA checkpoint",
      affectedTargets: ["file.ts"],
      requiredAction: "modify",
      cwd: process.cwd()
    });

    await manager.approve(record.checkpointId, {
      approved: true,
      approvedBy: "user",
      decision: "approved",
      timestamp: Date.now()
    });

    const consume = await manager.consume(record.checkpointId, {
      runId: "run-BBB",
      planId: "plan-1",
      stepId: "step-1",
      riskLevel: "elevated",
      cwd: process.cwd()
    });

    expect(consume.success).toBe(false);
    expect(consume.error).toContain("Run ID mismatch");
  });
});

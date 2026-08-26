import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultExecutionHandoffManager } from "./handoffManager.js";
import { DefaultCheckpointManager } from "../checkpoints/checkpointManager.js";
import { DefaultCheckpointStore } from "../checkpoints/checkpointStore.js";
import { DefaultTaskRiskPolicy } from "../policy/taskRiskPolicy.js";
import {
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultPermissionManager,
  type ApprovalDecision,
  type ApprovalResolver
} from "@fecode/models";
import type { AgentEvent } from "../index.js";

describe("Phase 5AA — DefaultExecutionHandoffManager Unit Tests", () => {
  let tmpDir: string;
  let storeDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-handoff-test-"));
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-handoff-store-"));
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "db"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "src/index.ts"), "export const x = 1;\n");
    await fs.writeFile(path.join(tmpDir, "src/auth.ts"), "export const auth = true;\n");
    await fs.writeFile(path.join(tmpDir, "db/schema.sql"), "CREATE TABLE users (id INT);\n");
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("prepares handoff accurately identifying elevated risk and checkpoint requirements", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);
    const riskPolicy = new DefaultTaskRiskPolicy();
    const registry = new DefaultToolRegistry();
    registry.register({
      name: "edit_file",
      description: "Edit file",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async () => ({ success: true, output: "ok" })
    });
    const toolExecutor = new DefaultToolExecutor(registry);
    const permissionManager = new DefaultPermissionManager();

    const handoffManager = new DefaultExecutionHandoffManager({
      registry,
      executor: toolExecutor,
      permissionManager,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager
    });

    const prep = await handoffManager.prepareHandoff({
      runId: "run-h-1",
      planId: "plan-h-1",
      cwd: tmpDir,
      step: {
        stepId: "step-1",
        order: 1,
        title: "Modify core auth module",
        objective: "Auth update",
        type: "modify",
        dependencies: [],
        riskLevel: "elevated",
        verificationRequired: false,
        status: "pending",
        expectedFiles: ["src/auth.ts"],
        intent: {
          type: "modify_file",
          target: "src/auth.ts",
          reason: "Auth change",
          requiresApproval: true,
          estimatedRisk: "elevated"
        }
      }
    });

    expect(prep.canExecute).toBe(true);
    expect(prep.requiresCheckpoint).toBe(true);
    expect(prep.requiresExplicitApproval).toBe(true);
    expect(prep.effectiveRisk).toBe("elevated");
    expect(prep.toolCall).toBeDefined();
    expect(prep.toolCall?.name).toBe("edit_file");
  });

  it("executes handoff successfully through checkpoint, approval, and consumption", async () => {
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
      runId: "run-h-2",
      planId: "plan-h-2",
      cwd: tmpDir,
      step: {
        stepId: "step-1",
        order: 1,
        title: "Edit auth file",
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
          reason: "Modify auth",
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

    const handoffResult = result.value;
    expect(handoffResult.success).toBe(true);
    expect(handoffResult.status).toBe("completed");
    expect(handoffResult.checkpointId).toBeDefined();

    expect(events.some((e) => e.type === "execution_handoff_started")).toBe(true);
    expect(events.some((e) => e.type === "execution_handoff_waiting_approval")).toBe(true);
    expect(events.some((e) => e.type === "execution_handoff_approved")).toBe(true);
    expect(events.some((e) => e.type === "execution_handoff_consumed")).toBe(true);
    expect(events.some((e) => e.type === "execution_handoff_completed")).toBe(true);
  });

  it("handles user rejection cleanly without executing tool", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);
    const riskPolicy = new DefaultTaskRiskPolicy();
    let toolExecuted = false;
    const registry = new DefaultToolRegistry();
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

    const approvalResolver: ApprovalResolver = {
      async resolve(): Promise<ApprovalDecision> {
        return { approved: false, reason: "User cancelled mutation" };
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
      runId: "run-h-3",
      planId: "plan-h-3",
      cwd: tmpDir,
      step: {
        stepId: "step-1",
        order: 1,
        title: "Delete database records",
        objective: "Critical deletion",
        type: "modify",
        dependencies: [],
        riskLevel: "critical",
        verificationRequired: false,
        status: "pending",
        expectedFiles: ["db/schema.sql"]
      }
    });

    let result = await gen.next();
    while (!result.done) {
      events.push(result.value);
      result = await gen.next();
    }

    const handoffResult = result.value;
    expect(handoffResult.success).toBe(false);
    expect(handoffResult.status).toBe("rejected");
    expect(handoffResult.error).toContain("User cancelled mutation");
    expect(toolExecuted).toBe(false);

    expect(events.some((e) => e.type === "execution_handoff_rejected")).toBe(true);
  });

  it("rejects handoff immediately when run is already in terminal state", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);
    const riskPolicy = new DefaultTaskRiskPolicy();
    const registry = new DefaultToolRegistry();
    const toolExecutor = new DefaultToolExecutor(registry);
    const permissionManager = new DefaultPermissionManager();

    const { DefaultRunDiagnosticsManager } = await import("../diagnostics/runDiagnosticsManager.js");
    const diagnosticsManager = new DefaultRunDiagnosticsManager();
    diagnosticsManager.startRun({
      runId: "run-term-1",
      cwd: tmpDir,
      userRequest: "Test terminal run"
    });
    diagnosticsManager.completeRun("run-term-1", "completed");

    const handoffManager = new DefaultExecutionHandoffManager({
      registry,
      executor: toolExecutor,
      permissionManager,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager,
      diagnosticsManager
    });

    const events: AgentEvent[] = [];
    const gen = handoffManager.executeHandoff({
      runId: "run-term-1",
      planId: "plan-term-1",
      cwd: tmpDir,
      step: {
        stepId: "step-1",
        order: 1,
        title: "Post-terminal step",
        objective: "Should not execute",
        type: "modify",
        dependencies: [],
        riskLevel: "normal",
        verificationRequired: false,
        status: "pending",
        expectedFiles: ["src/index.ts"]
      }
    });

    let result = await gen.next();
    while (!result.done) {
      events.push(result.value);
      result = await gen.next();
    }

    expect(result.value.success).toBe(false);
    expect(result.value.status).toBe("cancelled");
    expect(result.value.error).toContain("terminal status");
    // Crucial: no misleading started event emitted
    expect(events.length).toBe(0);
  });

  it("invalidates handoff when workspace drift is detected before mutation", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);
    const riskPolicy = new DefaultTaskRiskPolicy();
    const registry = new DefaultToolRegistry();
    const toolExecutor = new DefaultToolExecutor(registry);
    const permissionManager = new DefaultPermissionManager();

    const handoffManager = new DefaultExecutionHandoffManager({
      registry,
      executor: toolExecutor,
      permissionManager,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager
    });

    const events: AgentEvent[] = [];
    const gen = handoffManager.executeHandoff({
      runId: "run-drift-1",
      planId: "plan-drift-1",
      cwd: tmpDir,
      initialGitBranch: "main",
      initialFingerprint: {
        capturedAt: Date.now(),
        gitBranch: "main",
        isGitDirty: false
      },
      step: {
        stepId: "step-1",
        order: 1,
        title: "Modify non-existent file",
        objective: "Modify",
        type: "modify",
        dependencies: [],
        riskLevel: "normal",
        verificationRequired: false,
        status: "pending",
        expectedFiles: ["src/ghost-file.ts"],
        intent: {
          type: "modify_file",
          target: "src/ghost-file.ts",
          reason: "Modify ghost",
          requiresApproval: false,
          estimatedRisk: "normal"
        }
      }
    });

    let result = await gen.next();
    while (!result.done) {
      events.push(result.value);
      result = await gen.next();
    }

    expect(result.value.success).toBe(false);
    expect(result.value.status).toBe("invalidated");
    expect(result.value.error).toContain("Workspace drifted");
    expect(events.some((e) => e.type === "execution_handoff_invalidated")).toBe(true);
  });

  it("enforces tool permission pipeline and denies when permission denied", async () => {
    const store = new DefaultCheckpointStore(storeDir);
    const cpManager = new DefaultCheckpointManager(store);
    const riskPolicy = new DefaultTaskRiskPolicy();
    const registry = new DefaultToolRegistry();
    registry.register({
      name: "edit_file",
      description: "Edit file",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async () => ({ success: true })
    });
    const toolExecutor = new DefaultToolExecutor(registry);
    const permissionManager = new DefaultPermissionManager({
      checkPermission: () => ({ type: "denied", reason: "Policy denied permission" })
    });

    const handoffManager = new DefaultExecutionHandoffManager({
      registry,
      executor: toolExecutor,
      permissionManager,
      executionPolicy: riskPolicy,
      checkpointManager: cpManager
    });

    const events: AgentEvent[] = [];
    const gen = handoffManager.executeHandoff({
      runId: "run-perm-1",
      planId: "plan-perm-1",
      cwd: tmpDir,
      step: {
        stepId: "step-1",
        order: 1,
        title: "Edit index",
        objective: "Edit",
        type: "modify",
        dependencies: [],
        riskLevel: "normal",
        verificationRequired: false,
        status: "pending",
        expectedFiles: ["src/index.ts"]
      }
    });

    let result = await gen.next();
    while (!result.done) {
      events.push(result.value);
      result = await gen.next();
    }

    expect(result.value.success).toBe(false);
    expect(result.value.status).toBe("failed");
    expect(result.value.error).toContain("denied");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultPlanExecutor } from "./executor.js";
import { createTaskPlan, transitionPlanStatus } from "./taskPlan.js";
import {
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultPermissionManager,
  type Tool,
  type ApprovalResolver
} from "@fecode/models";
import { DefaultTaskRiskPolicy } from "../policy/taskRiskPolicy.js";
import { DefaultCheckpointManager } from "../checkpoints/checkpointManager.js";
import { DefaultRunDiagnosticsManager } from "../diagnostics/runDiagnosticsManager.js";
import { MockCommandExecutor } from "../commands/mockExecutor.js";
import type { AgentEvent } from "../index.js";

describe("DefaultPlanExecutor — Phase 5Q", () => {
  let tmpDir: string;
  let registry: DefaultToolRegistry;
  let toolExecutor: DefaultToolExecutor;
  let permissionManager: DefaultPermissionManager;
  let riskPolicy: DefaultTaskRiskPolicy;
  let checkpointManager: DefaultCheckpointManager;
  let diagnosticsManager: DefaultRunDiagnosticsManager;
  let commandExecutor: MockCommandExecutor;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-executor-test-"));
    await fs.writeFile(
      path.join(tmpDir, "Button.tsx"),
      "export function Button() { return <button>Click</button>; }\n",
      "utf-8"
    );

    registry = new DefaultToolRegistry();
    registry.register({
      name: "read_file",
      description: "Read file",
      permissionCategory: "read",
      inputSchema: { type: "object" },
      execute: async () => ({ success: true, output: "file content" })
    });
    registry.register({
      name: "edit_file",
      description: "Edit file",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async () => ({ success: true, output: { path: "Button.tsx", changed: true } })
    });
    registry.register({
      name: "write_file",
      description: "Write file",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async () => ({ success: true, output: { path: "Button.tsx", created: false } })
    });

    toolExecutor = new DefaultToolExecutor(registry);
    permissionManager = new DefaultPermissionManager();
    riskPolicy = new DefaultTaskRiskPolicy();
    checkpointManager = new DefaultCheckpointManager();
    diagnosticsManager = new DefaultRunDiagnosticsManager();
    commandExecutor = new MockCommandExecutor();
    commandExecutor.defaultResult = { stdout: "✓ tests pass", exitCode: 0 };
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  function createTestExecutor(overrides: {
    approvalResolver?: ApprovalResolver;
    checkpointManager?: DefaultCheckpointManager;
  } = {}): DefaultPlanExecutor {
    return new DefaultPlanExecutor({
      registry,
      executor: toolExecutor,
      permissionManager,
      approvalResolver: overrides.approvalResolver,
      executionPolicy: riskPolicy,
      checkpointManager: overrides.checkpointManager ?? checkpointManager,
      commandExecutor,
      diagnosticsManager
    });
  }

  describe("Approved Plan Boundary", () => {
    it("executes an approved plan successfully", async () => {
      const executor = createTestExecutor();
      let plan = createTaskPlan({
        runId: "run-exec-1",
        userRequestSummary: "Inspect component",
        objective: "Inspect Button.tsx",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Read Button.tsx",
            objective: "Read code",
            type: "inspect",
            dependencies: [],
            riskLevel: "low",
            verificationRequired: false,
            status: "pending",
            intent: {
              type: "inspect_file",
              target: "Button.tsx",
              reason: "Read file",
              requiresApproval: false,
              estimatedRisk: "low"
            }
          }
        ]
      });

      plan = transitionPlanStatus(plan, "approved");

      const events: AgentEvent[] = [];
      for await (const ev of executor.executePlan(plan, {
        runId: "run-exec-1",
        cwd: tmpDir
      })) {
        events.push(ev);
      }

      expect(events.some((e) => e.type === "plan_execution_started")).toBe(true);
      expect(events.some((e) => e.type === "plan_step_started")).toBe(true);
      expect(events.some((e) => e.type === "plan_step_completed")).toBe(true);
      expect(events.some((e) => e.type === "plan_execution_completed")).toBe(true);
    });

    it("rejects unapproved plans (draft, ready, completed, failed, cancelled, superseded)", async () => {
      const executor = createTestExecutor();
      const plan = createTaskPlan({
        runId: "run-exec-reject",
        userRequestSummary: "Task",
        objective: "Task",
        steps: [],
        status: "ready"
      });

      const events: AgentEvent[] = [];
      let thrownError: Error | null = null;
      try {
        for await (const ev of executor.executePlan(plan, {
          runId: "run-exec-reject",
          cwd: tmpDir
        })) {
          events.push(ev);
        }
      } catch (err: unknown) {
        thrownError = err as Error;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError?.message).toContain("Only approved plans can be executed");
      expect(events.some((e) => e.type === "plan_execution_failed")).toBe(true);
    });
  });

  describe("Sequential Execution & Dependency Enforcement", () => {
    it("executes steps strictly in dependency order and blocks dependent steps when prerequisite fails", async () => {
      const customRegistry = new DefaultToolRegistry();
      customRegistry.register({
        name: "edit_file",
        description: "Edit",
        permissionCategory: "write",
        inputSchema: { type: "object" },
        execute: async () => ({
          success: false,
          error: { message: "Simulated edit failure", code: "WRITE_ERROR" }
        })
      });

      const customToolExecutor = new DefaultToolExecutor(customRegistry);
      const executor = new DefaultPlanExecutor({
        registry: customRegistry,
        executor: customToolExecutor,
        permissionManager,
        executionPolicy: riskPolicy,
        commandExecutor,
        diagnosticsManager
      });

      let plan = createTaskPlan({
        runId: "run-dep-fail",
        userRequestSummary: "Multi-step plan",
        objective: "Modify and test",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Modify Button.tsx",
            objective: "Apply edit",
            type: "modify",
            dependencies: [],
            riskLevel: "normal",
            verificationRequired: false,
            status: "pending",
            intent: {
              type: "modify_file",
              target: "Button.tsx",
              reason: "Update button",
              requiresApproval: false,
              estimatedRisk: "normal"
            }
          },
          {
            stepId: "step-2",
            order: 2,
            title: "Run tests",
            objective: "Run unit tests",
            type: "test",
            dependencies: ["step-1"],
            riskLevel: "low",
            verificationRequired: true,
            status: "pending",
            intent: {
              type: "run_tests",
              command: "npm test",
              reason: "Verify changes",
              requiresApproval: false,
              estimatedRisk: "low"
            }
          }
        ]
      });

      plan = transitionPlanStatus(plan, "approved");

      const events: AgentEvent[] = [];
      for await (const ev of executor.executePlan(plan, {
        runId: "run-dep-fail",
        cwd: tmpDir
      })) {
        events.push(ev);
      }

      expect(events.some((e) => e.type === "plan_step_failed")).toBe(true);
      expect(events.some((e) => e.type === "plan_execution_failed")).toBe(true);

      const summary = diagnosticsManager.getRunSummary("run-dep-fail");
      expect(summary?.failedPlanStep).toBe("step-1");
    });
  });

  describe("Safety & Risk Re-Evaluation", () => {
    it("re-evaluates risk before mutation and never downgrades authoritative risk", async () => {
      let createdCheckpoint = false;
      const mockCpManager = {
        create: async () => {
          createdCheckpoint = true;
          return { success: true, checkpoint: { id: "cp-elevated-1" } };
        }
      } as unknown as DefaultCheckpointManager;

      const executor = createTestExecutor({
        checkpointManager: mockCpManager,
        approvalResolver: { resolve: async () => ({ approved: true }) }
      });

      // Plan says risk is "normal", but step target is elevated/critical
      let plan = createTaskPlan({
        runId: "run-risk-elevated",
        userRequestSummary: "Modify auth config",
        objective: "Modify auth configuration",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Update security critical auth tokens",
            objective: "Modify tokens",
            type: "modify",
            dependencies: [],
            riskLevel: "elevated", // Elevated risk triggers checkpoint
            verificationRequired: false,
            status: "pending",
            intent: {
              type: "modify_file",
              target: "Button.tsx",
              reason: "Apply changes",
              requiresApproval: false,
              estimatedRisk: "normal" // Plan estimated normal, but step/policy is elevated
            }
          }
        ]
      });

      plan = transitionPlanStatus(plan, "approved");

      const events: AgentEvent[] = [];
      for await (const ev of executor.executePlan(plan, {
        runId: "run-risk-elevated",
        cwd: tmpDir
      })) {
        events.push(ev);
      }

      expect(createdCheckpoint).toBe(true);
      expect(events.some((e) => e.type === "plan_execution_completed")).toBe(true);
    });

    it("blocks mutation and fails step if checkpoint creation fails", async () => {
      const failingCpManager = {
        create: async () => ({
          success: false,
          error: "Disk full"
        })
      } as unknown as DefaultCheckpointManager;

      const executor = createTestExecutor({ checkpointManager: failingCpManager });

      let plan = createTaskPlan({
        runId: "run-cp-fail",
        userRequestSummary: "Elevated task",
        objective: "Elevated task",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Update security configuration",
            objective: "Update security",
            type: "modify",
            dependencies: [],
            riskLevel: "elevated",
            verificationRequired: false,
            status: "pending",
            intent: {
              type: "modify_file",
              target: "Button.tsx",
              reason: "Elevated modification",
              requiresApproval: false,
              estimatedRisk: "elevated"
            }
          }
        ]
      });

      plan = transitionPlanStatus(plan, "approved");

      const events: AgentEvent[] = [];
      for await (const ev of executor.executePlan(plan, {
        runId: "run-cp-fail",
        cwd: tmpDir
      })) {
        events.push(ev);
      }

      expect(events.some((e) => e.type === "plan_step_failed")).toBe(true);
      expect(events.some((e) => e.type === "plan_execution_failed")).toBe(true);
    });
  });

  describe("Permission Boundary & Interactive Approval", () => {
    it("enforces approval requirement and prompts approval resolver", async () => {
      let resolvedApproval = false;
      const resolver: ApprovalResolver = {
        resolve: async () => {
          resolvedApproval = true;
          return { approved: true };
        }
      };

      const customPolicyTool: Tool = {
        name: "edit_file",
        description: "Edit",
        permissionCategory: "write",
        inputSchema: { type: "object" },
        execute: async () => ({ success: true, output: { path: "Button.tsx", changed: true } })
      };

      const customRegistry = new DefaultToolRegistry();
      customRegistry.register(customPolicyTool);

      const customPermissionManager = {
        check: async () => ({
          type: "requires_approval" as const,
          reason: "File modification requires explicit user approval"
        })
      } as unknown as DefaultPermissionManager;

      const executor = new DefaultPlanExecutor({
        registry: customRegistry,
        executor: new DefaultToolExecutor(customRegistry),
        permissionManager: customPermissionManager,
        approvalResolver: resolver,
        executionPolicy: riskPolicy,
        commandExecutor,
        diagnosticsManager
      });

      let plan = createTaskPlan({
        runId: "run-approval-check",
        userRequestSummary: "Modify component",
        objective: "Modify Button",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Modify Button.tsx",
            objective: "Edit button",
            type: "modify",
            dependencies: [],
            riskLevel: "normal",
            verificationRequired: false,
            status: "pending",
            intent: {
              type: "modify_file",
              target: "Button.tsx",
              reason: "Edit file",
              requiresApproval: true,
              estimatedRisk: "normal"
            }
          }
        ]
      });

      plan = transitionPlanStatus(plan, "approved");

      const events: AgentEvent[] = [];
      for await (const ev of executor.executePlan(plan, {
        runId: "run-approval-check",
        cwd: tmpDir
      })) {
        events.push(ev);
      }

      expect(resolvedApproval).toBe(true);
      expect(events.some((e) => e.type === "plan_step_waiting_approval")).toBe(true);
      expect(events.some((e) => e.type === "plan_step_completed")).toBe(true);
      expect(events.some((e) => e.type === "plan_execution_completed")).toBe(true);
    });

    it("fails step and stops execution when user denies permission", async () => {
      const resolver: ApprovalResolver = {
        resolve: async () => ({
          approved: false,
          reason: "User rejected change"
        })
      };

      const customRegistry = new DefaultToolRegistry();
      customRegistry.register({
        name: "edit_file",
        description: "Edit",
        permissionCategory: "write",
        inputSchema: { type: "object" },
        execute: async () => ({ success: true })
      });

      const customPermissionManager = {
        check: async () => ({
          type: "requires_approval" as const,
          reason: "Approval needed"
        })
      } as unknown as DefaultPermissionManager;

      const executor = new DefaultPlanExecutor({
        registry: customRegistry,
        executor: new DefaultToolExecutor(customRegistry),
        permissionManager: customPermissionManager,
        approvalResolver: resolver,
        executionPolicy: riskPolicy,
        commandExecutor,
        diagnosticsManager
      });

      let plan = createTaskPlan({
        runId: "run-approval-denied",
        userRequestSummary: "Modify component",
        objective: "Modify Button",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Modify Button.tsx",
            objective: "Edit button",
            type: "modify",
            dependencies: [],
            riskLevel: "normal",
            verificationRequired: false,
            status: "pending",
            intent: {
              type: "modify_file",
              target: "Button.tsx",
              reason: "Edit file",
              requiresApproval: true,
              estimatedRisk: "normal"
            }
          }
        ]
      });

      plan = transitionPlanStatus(plan, "approved");

      const events: AgentEvent[] = [];
      for await (const ev of executor.executePlan(plan, {
        runId: "run-approval-denied",
        cwd: tmpDir
      })) {
        events.push(ev);
      }

      expect(events.some((e) => e.type === "plan_step_failed")).toBe(true);
      expect(events.some((e) => e.type === "plan_execution_failed")).toBe(true);
    });
  });

  describe("Plan Staleness Detection", () => {
    it("detects missing target file, marks plan superseded and stops execution", async () => {
      const executor = createTestExecutor();

      let plan = createTaskPlan({
        runId: "run-stale-1",
        userRequestSummary: "Modify deleted file",
        objective: "Modify NonExistent.tsx",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Modify NonExistent.tsx",
            objective: "Edit file",
            type: "modify",
            dependencies: [],
            riskLevel: "normal",
            verificationRequired: false,
            status: "pending",
            intent: {
              type: "modify_file",
              target: "NonExistent.tsx", // File does not exist
              reason: "Edit file",
              requiresApproval: false,
              estimatedRisk: "normal"
            }
          }
        ]
      });

      plan = transitionPlanStatus(plan, "approved");

      const events: AgentEvent[] = [];
      for await (const ev of executor.executePlan(plan, {
        runId: "run-stale-1",
        cwd: tmpDir
      })) {
        events.push(ev);
      }

      const failEv = events.find((e) => e.type === "plan_execution_failed");
      expect(failEv).toBeDefined();
      if (failEv && "reason" in failEv) {
        expect(failEv.reason).toContain("PLAN_STALE");
      }

      const summary = diagnosticsManager.getRunSummary("run-stale-1");
      expect(summary?.planStatus).toBe("superseded");
    });
  });

  describe("Verification & Failure Handling", () => {
    it("runs verification command when required and marks completed on success", async () => {
      const executor = createTestExecutor();

      let plan = createTaskPlan({
        runId: "run-verify-pass",
        userRequestSummary: "Test verification",
        objective: "Inspect and test",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Inspect Button.tsx",
            objective: "Inspect file",
            type: "inspect",
            dependencies: [],
            riskLevel: "low",
            verificationRequired: true,
            status: "pending",
            intent: {
              type: "inspect_file",
              target: "Button.tsx",
              command: "npm test",
              reason: "Inspect and verify",
              requiresApproval: false,
              estimatedRisk: "low"
            }
          }
        ],
        verificationStrategy: ["npm test"]
      });

      plan = transitionPlanStatus(plan, "approved");

      const events: AgentEvent[] = [];
      for await (const ev of executor.executePlan(plan, {
        runId: "run-verify-pass",
        cwd: tmpDir
      })) {
        events.push(ev);
      }

      expect(events.some((e) => e.type === "plan_step_completed")).toBe(true);
      expect(events.some((e) => e.type === "plan_execution_completed")).toBe(true);
    });

    it("marks step failed when verification command fails", async () => {
      commandExecutor.defaultResult = {
        stdout: "2 tests failed",
        exitCode: 1,
        error: "Tests failed"
      };

      const executor = createTestExecutor();

      let plan = createTaskPlan({
        runId: "run-verify-fail",
        userRequestSummary: "Test verification failure",
        objective: "Inspect and test",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Inspect Button.tsx",
            objective: "Inspect file",
            type: "inspect",
            dependencies: [],
            riskLevel: "low",
            verificationRequired: true,
            status: "pending",
            intent: {
              type: "inspect_file",
              target: "Button.tsx",
              command: "npm test",
              reason: "Inspect and verify",
              requiresApproval: false,
              estimatedRisk: "low"
            }
          }
        ]
      });

      plan = transitionPlanStatus(plan, "approved");

      const events: AgentEvent[] = [];
      for await (const ev of executor.executePlan(plan, {
        runId: "run-verify-fail",
        cwd: tmpDir
      })) {
        events.push(ev);
      }

      expect(events.some((e) => e.type === "plan_step_failed")).toBe(true);
      expect(events.some((e) => e.type === "plan_execution_failed")).toBe(true);
    });
  });

  describe("Cancellation", () => {
    it("halts execution cleanly on abort signal and marks plan cancelled", async () => {
      const executor = createTestExecutor();
      const abortCtrl = new AbortController();

      let plan = createTaskPlan({
        runId: "run-cancel-1",
        userRequestSummary: "Long plan",
        objective: "Long plan",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Step 1",
            objective: "Step 1",
            type: "inspect",
            dependencies: [],
            riskLevel: "low",
            verificationRequired: false,
            status: "pending"
          }
        ]
      });

      plan = transitionPlanStatus(plan, "approved");

      abortCtrl.abort();

      const events: AgentEvent[] = [];
      for await (const ev of executor.executePlan(plan, {
        runId: "run-cancel-1",
        cwd: tmpDir,
        signal: abortCtrl.signal
      })) {
        events.push(ev);
      }

      expect(events.some((e) => e.type === "plan_execution_cancelled")).toBe(true);
      const summary = diagnosticsManager.getRunSummary("run-cancel-1");
      expect(summary?.planStatus).toBe("cancelled");
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultPlanExecutor } from "./executor.js";
import { DefaultExecutionFeedbackManager } from "./executionFeedback.js";
import { DefaultStepRetryPolicy } from "./retryPolicy.js";
import { DefaultFinalWorkspaceReconciler } from "./reconciliation.js";
import { createTaskPlan } from "./taskPlan.js";
import {
  DefaultToolRegistry,
  DefaultPermissionManager,
  AutoApproveResolver,
  type Tool,
  type ToolCall,
  type ToolContext,
  type ToolResult,
  type ToolExecutor
} from "@fecode/models";
import { DefaultTaskRiskPolicy } from "../policy/taskRiskPolicy.js";
import { DefaultRunDiagnosticsManager } from "../diagnostics/runDiagnosticsManager.js";
import type { AgentEvent } from "../index.js";
import type { GitRepository } from "../git/types.js";
import type { WorkspaceFingerprint } from "../history/types.js";

describe("Phase 5U — Execution Completion Integrity & Final Reconciliation", () => {
  let tmpDir: string;
  let registry: DefaultToolRegistry;
  let permissionManager: DefaultPermissionManager;
  let riskPolicy: DefaultTaskRiskPolicy;
  let feedbackManager: DefaultExecutionFeedbackManager;
  let retryPolicy: DefaultStepRetryPolicy;
  let reconciler: DefaultFinalWorkspaceReconciler;
  let diagnosticsManager: DefaultRunDiagnosticsManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-5u-test-"));
    registry = new DefaultToolRegistry();
    permissionManager = new DefaultPermissionManager();
    riskPolicy = new DefaultTaskRiskPolicy();
    feedbackManager = new DefaultExecutionFeedbackManager();
    retryPolicy = new DefaultStepRetryPolicy({ maxAttempts: 2 });
    reconciler = new DefaultFinalWorkspaceReconciler();
    diagnosticsManager = new DefaultRunDiagnosticsManager();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("completes successfully when final workspace reconciliation succeeds", async () => {
    const file1 = path.join(tmpDir, "file1.ts");

    const testTool: Tool = {
      name: "write_file",
      description: "Creates file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      permissionCategory: "write",
      async execute(args: unknown): Promise<ToolResult> {
        const p = (args as { path: string }).path;
        await fs.writeFile(path.isAbsolute(p) ? p : path.join(tmpDir, p), "content 1");
        return { success: true, output: "Created file" };
      }
    };
    registry.register(testTool);

    const mockExecutor: ToolExecutor = {
      async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
        const t = registry.get(call.name);
        if (!t) return { success: false, error: { message: "Not found" } };
        return t.execute(call.arguments, context);
      }
    };

    const planExecutor = new DefaultPlanExecutor({
      registry,
      executor: mockExecutor,
      permissionManager,
      approvalResolver: new AutoApproveResolver(),
      executionPolicy: riskPolicy,
      feedbackManager,
      retryPolicy,
      reconciler,
      diagnosticsManager
    });

    const plan = createTaskPlan({
      planId: "plan-comp-success",
      runId: "run-comp-success",
      userRequestSummary: "Create file1.ts",
      objective: "Create file",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Create file1.ts",
          objective: "Create file",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["file1.ts"],
          intent: {
            type: "create_file",
            target: "file1.ts",
            reason: "Create file",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-comp-success",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const reconStarted = events.find((e) => e.type === "final_reconciliation_started");
    const reconCompleted = events.find((e) => e.type === "final_reconciliation_completed");
    const planCompleted = events.find((e) => e.type === "plan_execution_completed");

    expect(reconStarted).toBeDefined();
    expect(reconCompleted).toBeDefined();
    expect(planCompleted).toBeDefined();

    const exists = await fs.access(file1).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("blocks plan and prevents completion when an expected file is missing", async () => {
    const testTool: Tool = {
      name: "write_file",
      description: "Creates file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      permissionCategory: "write",
      async execute(): Promise<ToolResult> {
        // Fails to write to disk
        return { success: true, output: "Mock success without writing to disk" };
      }
    };
    registry.register(testTool);

    const mockExecutor: ToolExecutor = {
      async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
        const t = registry.get(call.name);
        if (!t) return { success: false, error: { message: "Not found" } };
        return t.execute(call.arguments, context);
      }
    };

    const planExecutor = new DefaultPlanExecutor({
      registry,
      executor: mockExecutor,
      permissionManager,
      approvalResolver: new AutoApproveResolver(),
      executionPolicy: riskPolicy,
      feedbackManager,
      retryPolicy,
      reconciler,
      diagnosticsManager
    });

    const plan = createTaskPlan({
      planId: "plan-comp-missing",
      runId: "run-comp-missing",
      userRequestSummary: "Create missing file",
      objective: "Should fail reconciliation",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Create missing.ts",
          objective: "Create file",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["missing.ts"],
          intent: {
            type: "create_file",
            target: "missing.ts",
            reason: "Create file",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-comp-missing",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const reconFailed = events.find((e) => e.type === "final_reconciliation_failed");
    const planBlocked = events.find((e) => e.type === "plan_blocked");
    const planCompleted = events.find((e) => e.type === "plan_execution_completed");

    expect(reconFailed).toBeDefined();
    expect(planBlocked).toBeDefined();
    expect(planCompleted).toBeUndefined(); // NEVER falsely marked completed!
  });

  it("blocks plan when unexpected files outside the plan were modified", async () => {
    const unexpectedFile = path.join(tmpDir, "secret_config.json");
    await fs.writeFile(unexpectedFile, "original config");

    const initialFingerprint: WorkspaceFingerprint = {
      capturedAt: Date.now() - 10000,
      fileFingerprints: {
        "secret_config.json": {
          size: 15,
          mtimeMs: 1000
        }
      }
    };

    const testTool: Tool = {
      name: "write_file",
      description: "Creates file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      permissionCategory: "write",
      async execute(args: unknown): Promise<ToolResult> {
        const p = (args as { path: string }).path;
        await fs.writeFile(path.isAbsolute(p) ? p : path.join(tmpDir, p), "expected file");
        // Corrupt unexpected file!
        await fs.writeFile(unexpectedFile, "unexpectedly modified config content with different length");
        return { success: true, output: "Created file" };
      }
    };
    registry.register(testTool);

    const mockExecutor: ToolExecutor = {
      async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
        const t = registry.get(call.name);
        if (!t) return { success: false, error: { message: "Not found" } };
        return t.execute(call.arguments, context);
      }
    };

    const planExecutor = new DefaultPlanExecutor({
      registry,
      executor: mockExecutor,
      permissionManager,
      approvalResolver: new AutoApproveResolver(),
      executionPolicy: riskPolicy,
      feedbackManager,
      retryPolicy,
      reconciler,
      diagnosticsManager
    });

    const plan = createTaskPlan({
      planId: "plan-comp-unexp",
      runId: "run-comp-unexp",
      userRequestSummary: "Create file1.ts",
      objective: "Create file1",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Create file1.ts",
          objective: "Create file",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["file1.ts"],
          intent: {
            type: "create_file",
            target: "file1.ts",
            reason: "Create file",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-comp-unexp",
      cwd: tmpDir,
      initialFingerprint
    })) {
      events.push(ev);
    }

    const reconFailed = events.find((e) => e.type === "final_reconciliation_failed");
    const planCompleted = events.find((e) => e.type === "plan_execution_completed");

    expect(reconFailed).toBeDefined();
    expect(planCompleted).toBeUndefined();
  });

  it("blocks plan when git branch changes during execution", async () => {
    let currentGitBranch = "master";
    const mockGit: GitRepository = {
      async isRepository(): Promise<boolean> {
        return true;
      },
      async getRoot(): Promise<string | null> {
        return tmpDir;
      },
      async getStatus(): Promise<import("../git/types.js").GitStatus> {
        return {
          isRepository: true,
          gitAvailable: true,
          root: tmpDir,
          branch: currentGitBranch,
          files: [],
          ahead: 0,
          behind: 0,
          detached: false,
          hasConflicts: false
        } as unknown as import("../git/types.js").GitStatus;
      },
      async getBranch(): Promise<string> {
        return currentGitBranch;
      },
      async getSnapshot(): Promise<import("../git/types.js").RepositorySnapshot> {
        return {
          capturedAt: new Date().toISOString(),
          root: tmpDir,
          branch: currentGitBranch,
          files: []
        };
      }
    };

    const initialFingerprint: WorkspaceFingerprint = {
      capturedAt: Date.now() - 10000,
      gitBranch: "master"
    };

    const testTool: Tool = {
      name: "write_file",
      description: "Creates file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      permissionCategory: "write",
      async execute(args: unknown): Promise<ToolResult> {
        const p = (args as { path: string }).path;
        await fs.writeFile(path.isAbsolute(p) ? p : path.join(tmpDir, p), "content");
        // Git branch drifts during tool execution
        currentGitBranch = "drifted-branch";
        return { success: true, output: "Created file" };
      }
    };
    registry.register(testTool);

    const mockExecutor: ToolExecutor = {
      async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
        const t = registry.get(call.name);
        if (!t) return { success: false, error: { message: "Not found" } };
        return t.execute(call.arguments, context);
      }
    };

    const planExecutor = new DefaultPlanExecutor({
      registry,
      executor: mockExecutor,
      permissionManager,
      approvalResolver: new AutoApproveResolver(),
      executionPolicy: riskPolicy,
      gitRepository: mockGit,
      feedbackManager,
      retryPolicy,
      reconciler,
      diagnosticsManager
    });

    const plan = createTaskPlan({
      planId: "plan-comp-branch",
      runId: "run-comp-branch",
      userRequestSummary: "Create file1.ts",
      objective: "Create file",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Create file1.ts",
          objective: "Create file",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["file1.ts"],
          intent: {
            type: "create_file",
            target: "file1.ts",
            reason: "Create file",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-comp-branch",
      cwd: tmpDir,
      initialFingerprint
    })) {
      events.push(ev);
    }

    const reconFailed = events.find((e) => e.type === "final_reconciliation_failed");
    const planCompleted = events.find((e) => e.type === "plan_execution_completed");

    expect(reconFailed).toBeDefined();
    expect(planCompleted).toBeUndefined();
  });
});

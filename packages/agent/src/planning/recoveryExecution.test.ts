import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultPlanExecutor } from "./executor.js";
import { DefaultExecutionFeedbackManager } from "./executionFeedback.js";
import { DefaultStepRetryPolicy } from "./retryPolicy.js";
import { DefaultExecutionDecisionManager } from "./decisionManager.js";
import { createTaskPlan, blockPlan } from "./taskPlan.js";
import {
  DefaultToolRegistry,
  DefaultPermissionManager,
  AutoApproveResolver,
  type Tool,
  type ToolCall,
  type ToolContext,
  type ToolResult,
  type ToolExecutor,
  type ApprovalResolver,
  type ApprovalDecision
} from "@fecode/models";
import { DefaultTaskRiskPolicy } from "../policy/taskRiskPolicy.js";
import { DefaultRunDiagnosticsManager } from "../diagnostics/runDiagnosticsManager.js";
import type { AgentEvent } from "../index.js";

describe("Phase 5T — Execution Recovery & Decision Continuity", () => {
  let tmpDir: string;
  let registry: DefaultToolRegistry;
  let permissionManager: DefaultPermissionManager;
  let riskPolicy: DefaultTaskRiskPolicy;
  let feedbackManager: DefaultExecutionFeedbackManager;
  let retryPolicy: DefaultStepRetryPolicy;
  let decisionManager: DefaultExecutionDecisionManager;
  let diagnosticsManager: DefaultRunDiagnosticsManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-5t-test-"));
    registry = new DefaultToolRegistry();
    permissionManager = new DefaultPermissionManager();
    riskPolicy = new DefaultTaskRiskPolicy();
    feedbackManager = new DefaultExecutionFeedbackManager();
    retryPolicy = new DefaultStepRetryPolicy({ maxAttempts: 2 });
    decisionManager = new DefaultExecutionDecisionManager();
    diagnosticsManager = new DefaultRunDiagnosticsManager();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("resumes from the first incomplete step and never replays completed steps", async () => {
    const executedSteps: string[] = [];

    const testTool: Tool = {
      name: "edit_file",
      description: "Edits file",
      inputSchema: { type: "object", properties: { target: { type: "string" } } },
      permissionCategory: "write",
      async execute(args: unknown): Promise<ToolResult> {
        const target = (args as { path?: string; target?: string })?.path || (args as { path?: string; target?: string })?.target || "unknown";
        executedSteps.push(target);
        return { success: true, output: `Edited ${target}` };
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
      diagnosticsManager
    });

    await fs.writeFile(path.join(tmpDir, "file1.ts"), "file 1");
    await fs.writeFile(path.join(tmpDir, "file2.ts"), "file 2");
    await fs.writeFile(path.join(tmpDir, "file3.ts"), "file 3");

    let plan = createTaskPlan({
      planId: "plan-rec-1",
      runId: "run-rec-1",
      userRequestSummary: "Multi-step fix",
      objective: "Fix multiple files",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Step 1: Edit file1.ts",
          objective: "Edit file1",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "completed", // ALREADY COMPLETED!
          intent: {
            type: "modify_file",
            target: "file1.ts",
            reason: "Edit file 1",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Step 2: Edit file2.ts",
          objective: "Edit file2",
          type: "modify",
          dependencies: ["step-1"],
          riskLevel: "normal",
          verificationRequired: false,
          status: "failed", // FAILED & BLOCKED
          error: "Transient lock error",
          intent: {
            type: "modify_file",
            target: "file2.ts",
            reason: "Edit file 2",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        },
        {
          stepId: "step-3",
          order: 3,
          title: "Step 3: Edit file3.ts",
          objective: "Edit file3",
          type: "modify",
          dependencies: ["step-2"],
          riskLevel: "normal",
          verificationRequired: false,
          status: "skipped",
          intent: {
            type: "modify_file",
            target: "file3.ts",
            reason: "Edit file 3",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    plan = blockPlan(plan, "Transient lock error on step-2");

    // Decision request created on block
    const req = decisionManager.createDecisionRequest({
      runId: "run-rec-1",
      planId: "plan-rec-1",
      blockedStepId: "step-2",
      affectedStepIds: ["step-2", "step-3"],
      reason: "Transient lock error"
    });

    // User chooses 'continue'
    const decisionResult = await decisionManager.resolveDecision(req, "continue", { plan });
    expect(decisionResult.accepted).toBe(true);
    expect(decisionResult.decision).toBe("continue");
    expect(decisionResult.resumedStepId).toBe("step-2");

    // Execute resume
    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.resumePlan(plan, {
      runId: "run-rec-1",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    // Step 1 was NEVER re-executed!
    expect(executedSteps).not.toContain("file1.ts");
    expect(executedSteps).toContain("file2.ts");
    expect(executedSteps).toContain("file3.ts");

    // Verified events
    const resumeStarted = events.find((e) => e.type === "execution_resume_started");
    const resumeCompleted = events.find((e) => e.type === "execution_resume_completed");
    const planCompleted = events.find((e) => e.type === "plan_execution_completed");

    expect(resumeStarted).toBeDefined();
    if (resumeStarted && resumeStarted.type === "execution_resume_started") {
      expect(resumeStarted.stepId).toBe("step-2");
      expect(resumeStarted.stepOrder).toBe(2);
      expect(resumeStarted.planId).toBe("plan-rec-1"); // Preserves planId!
    }

    expect(resumeCompleted).toBeDefined();
    expect(planCompleted).toBeDefined();
  });

  it("detects workspace drift between blocking and continue, refusing unsafe resume", async () => {
    let toolCalls = 0;
    const testTool: Tool = {
      name: "edit_file",
      description: "Edits file",
      inputSchema: { type: "object", properties: { target: { type: "string" } } },
      permissionCategory: "write",
      async execute(): Promise<ToolResult> {
        toolCalls++;
        return { success: true, output: "ok" };
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
      diagnosticsManager
    });

    const targetFile = path.join(tmpDir, "Component.tsx");
    await fs.writeFile(targetFile, "original content");

    let plan = createTaskPlan({
      planId: "plan-drift-rec",
      runId: "run-drift-rec",
      userRequestSummary: "Fix Component",
      objective: "Fix component",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Edit Component.tsx",
          objective: "Edit component",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["Component.tsx"],
          intent: {
            type: "modify_file",
            target: "Component.tsx",
            reason: "Edit file",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    plan = blockPlan(plan, "Initial lock failure");

    // User modifies file externally before continue
    await fs.writeFile(targetFile, "externally modified content by another process");

    const initialFingerprint = {
      capturedAt: Date.now() - 10000,
      fileFingerprints: {
        [targetFile]: {
          mtimeMs: 1000,
          size: 16,
          hash: "old-hash"
        }
      }
    };

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.resumePlan(plan, {
      runId: "run-drift-rec",
      cwd: tmpDir,
      initialFingerprint
    })) {
      events.push(ev);
    }

    const resumeFailed = events.find((e) => e.type === "execution_resume_failed");
    const planBlocked = events.find((e) => e.type === "plan_blocked");

    expect(resumeFailed).toBeDefined();
    expect(planBlocked).toBeDefined();
    expect(toolCalls).toBe(0); // Tool was not executed due to drift!
  });

  it("handles cancellation during plan execution cleanly and idempotently", async () => {
    let toolCalls = 0;
    const testTool: Tool = {
      name: "edit_file",
      description: "Edits file",
      inputSchema: { type: "object", properties: { target: { type: "string" } } },
      permissionCategory: "write",
      async execute(): Promise<ToolResult> {
        toolCalls++;
        return { success: true, output: "ok" };
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
      diagnosticsManager
    });

    const abortController = new AbortController();
    abortController.abort(); // Pre-aborted

    const plan = createTaskPlan({
      planId: "plan-cancel-test",
      runId: "run-cancel-test",
      userRequestSummary: "Cancelled task",
      objective: "Should not execute",
      status: "approved",
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
          status: "pending",
          intent: {
            type: "modify_file",
            target: "test.ts",
            reason: "Modify file",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-cancel-test",
      cwd: tmpDir,
      signal: abortController.signal
    })) {
      events.push(ev);
    }

    const cancelledEvent = events.find((e) => e.type === "plan_execution_cancelled");
    expect(cancelledEvent).toBeDefined();
    expect(toolCalls).toBe(0);
  });

  it("requires fresh permissions for resumed mutations", async () => {
    const testTool: Tool = {
      name: "edit_file",
      description: "Edits file",
      inputSchema: { type: "object", properties: { target: { type: "string" } } },
      permissionCategory: "write",
      async execute(): Promise<ToolResult> {
        return { success: true, output: "ok" };
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

    // Denying resolver
    const denyingResolver: ApprovalResolver = {
      async resolve(): Promise<ApprovalDecision> {
        return { approved: false, reason: "User denied permission" };
      }
    };

    const planExecutor = new DefaultPlanExecutor({
      registry,
      executor: mockExecutor,
      permissionManager,
      approvalResolver: denyingResolver,
      executionPolicy: riskPolicy,
      feedbackManager,
      retryPolicy,
      diagnosticsManager
    });

    const targetFile = path.join(tmpDir, "denied.ts");
    await fs.writeFile(targetFile, "content");

    let plan = createTaskPlan({
      planId: "plan-perm-denied",
      runId: "run-perm-denied",
      userRequestSummary: "Permission denied test",
      objective: "Should fail on denied permission",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Edit denied.ts",
          objective: "Edit file",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["denied.ts"],
          intent: {
            type: "modify_file",
            target: "denied.ts",
            reason: "Modify file",
            requiresApproval: true,
            estimatedRisk: "normal"
          }
        }
      ]
    });
    plan = blockPlan(plan, "Previous issue");

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.resumePlan(plan, {
      runId: "run-perm-denied",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const planBlocked = events.find((e) => e.type === "plan_blocked");
    expect(planBlocked).toBeDefined();
  });

  it("never automatically retries destructive operations like delete_file", async () => {
    let attempts = 0;
    const testTool: Tool = {
      name: "delete_file",
      description: "Deletes file",
      inputSchema: { type: "object", properties: { target: { type: "string" } } },
      permissionCategory: "write",
      async execute(): Promise<ToolResult> {
        attempts++;
        return { success: false, error: { message: "Permission error on filesystem" } };
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
      diagnosticsManager
    });

    const targetFile = path.join(tmpDir, "to_delete.txt");
    await fs.writeFile(targetFile, "trash");

    const plan = createTaskPlan({
      planId: "plan-destructive",
      runId: "run-destructive",
      userRequestSummary: "Delete test",
      objective: "Delete file",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Delete file",
          objective: "Delete file",
          type: "modify",
          dependencies: [],
          riskLevel: "elevated",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["to_delete.txt"],
          intent: {
            type: "delete_file",
            target: "to_delete.txt",
            reason: "Delete file",
            requiresApproval: true,
            estimatedRisk: "elevated"
          }
        }
      ]
    });

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-destructive",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    expect(attempts).toBe(1); // Executed exactly once; NEVER retried!
    const retryStarted = events.find((e) => e.type === "step_retry_started");
    expect(retryStarted).toBeUndefined();
  });
});

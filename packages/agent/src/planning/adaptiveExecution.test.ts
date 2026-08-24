import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultPlanExecutor } from "./executor.js";
import { DefaultExecutionFeedbackManager } from "./executionFeedback.js";
import { DefaultStepRetryPolicy } from "./retryPolicy.js";
import { createTaskPlan } from "./taskPlan.js";
import { DefaultTaskRiskPolicy } from "../policy/taskRiskPolicy.js";
import { DefaultToolRegistry, DefaultPermissionManager, AutoApproveResolver } from "@fecode/models";
import type { Tool, ToolContext, ToolResult, ToolExecutor, ToolCall } from "@fecode/models";
import type { AgentEvent } from "../index.js";
import type { CommandExecutor, CommandResult } from "../commands/types.js";

describe("Adaptive Plan Execution & Feedback — Phase 5S", () => {
  let tmpDir: string;
  let registry: DefaultToolRegistry;
  let permissionManager: DefaultPermissionManager;
  let riskPolicy: DefaultTaskRiskPolicy;
  let feedbackManager: DefaultExecutionFeedbackManager;
  let retryPolicy: DefaultStepRetryPolicy;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-adaptive-test-"));
    registry = new DefaultToolRegistry();
    permissionManager = new DefaultPermissionManager();
    riskPolicy = new DefaultTaskRiskPolicy();
    feedbackManager = new DefaultExecutionFeedbackManager();
    retryPolicy = new DefaultStepRetryPolicy({ maxAttempts: 2 });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("attempts bounded retry when verification fails on first attempt and succeeds on second attempt", async () => {
    let toolExecutionCount = 0;
    const testTool: Tool = {
      name: "edit_file",
      description: "Edits file",
      inputSchema: { type: "object", properties: { target: { type: "string" } } },
      permissionCategory: "write",
      async execute(): Promise<ToolResult> {
        toolExecutionCount++;
        return { success: true, output: "File edited" };
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

    let verifyAttempt = 0;
    const mockCommandExecutor: CommandExecutor = {
      async execute(command: string): Promise<CommandResult> {
        verifyAttempt++;
        if (verifyAttempt === 1) {
          // First attempt fails
          return {
            command,
            stdout: "",
            stderr: "Syntax error on line 4",
            exitCode: 1,
            timedOut: false,
            truncated: false
          };
        }
        // Second attempt succeeds
        return {
          command,
          stdout: "All tests pass",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          truncated: false
        };
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
      commandExecutor: mockCommandExecutor
    });

    const plan = createTaskPlan({
      planId: "plan-retry-test",
      runId: "run-retry-test",
      userRequestSummary: "Fix handler",
      objective: "Fix button handler",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Modify handler in Button.tsx",
          objective: "Edit Button.tsx",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: true,
          status: "pending",
          intent: {
            type: "modify_file",
            target: "Button.tsx",
            reason: "Edit handler",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    await fs.writeFile(
      path.join(tmpDir, "Button.tsx"),
      "export const Button = () => null;"
    );

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-retry-test",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    // Verified retry events
    const retryStarted = events.find((e) => e.type === "step_retry_started");
    const retryCompleted = events.find((e) => e.type === "step_retry_completed");
    const planCompleted = events.find((e) => e.type === "plan_execution_completed");

    expect(retryStarted).toBeDefined();
    expect(retryCompleted).toBeDefined();
    expect(planCompleted).toBeDefined();
    expect(toolExecutionCount).toBe(2); // Retried tool execution
    expect(verifyAttempt).toBe(2);
  });

  it("blocks the plan and emits plan_blocked when retries are exhausted", async () => {
    const testTool: Tool = {
      name: "edit_file",
      description: "Edits file",
      inputSchema: { type: "object", properties: { target: { type: "string" } } },
      permissionCategory: "write",
      async execute(): Promise<ToolResult> {
        return { success: true, output: "Edited" };
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

    const mockCommandExecutor: CommandExecutor = {
      async execute(command: string): Promise<CommandResult> {
        // Persistent verification failure
        return {
          command,
          stdout: "",
          stderr: "TypeScript compile error",
          exitCode: 1,
          timedOut: false,
          truncated: false
        };
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
      commandExecutor: mockCommandExecutor
    });

    const plan = createTaskPlan({
      planId: "plan-exhaust-test",
      runId: "run-exhaust-test",
      userRequestSummary: "Broken task",
      objective: "Task that cannot verify",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Modify Button.tsx",
          objective: "Edit Button",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: true,
          status: "pending",
          intent: {
            type: "modify_file",
            target: "Button.tsx",
            reason: "Edit handler",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Run downstream verification",
          objective: "Verify whole app",
          type: "verify",
          dependencies: ["step-1"],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending"
        }
      ]
    });

    await fs.writeFile(
      path.join(tmpDir, "Button.tsx"),
      "export const Button = () => null;"
    );

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-exhaust-test",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const planBlockedEvent = events.find((e) => e.type === "plan_blocked");
    const adaptationReqEvent = events.find((e) => e.type === "plan_adaptation_required");

    expect(planBlockedEvent).toBeDefined();
    expect(adaptationReqEvent).toBeDefined();

    if (planBlockedEvent && planBlockedEvent.type === "plan_blocked") {
      expect(planBlockedEvent.blockedStepId).toBe("step-1");
      expect(planBlockedEvent.affectedSteps).toContain("step-1");
      expect(planBlockedEvent.affectedSteps).toContain("step-2");
      expect(planBlockedEvent.recommendedAction).toBe("replan");
    }

    const feedbacks = feedbackManager.getPlanFeedback("plan-exhaust-test");
    expect(feedbacks.some((f) => f.severity === "blocking")).toBe(true);
  });

  it("never automatically retries destructive operations", async () => {
    let deleteCount = 0;
    const deleteTool: Tool = {
      name: "delete_file",
      description: "Deletes a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      permissionCategory: "write",
      async execute(): Promise<ToolResult> {
        deleteCount++;
        return { success: false, error: { message: "File locked" } };
      }
    };
    registry.register(deleteTool);

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
      retryPolicy
    });

    const plan = createTaskPlan({
      planId: "plan-destructive-test",
      runId: "run-destructive-test",
      userRequestSummary: "Delete sensitive file",
      objective: "Remove temp file",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Delete temp.txt",
          objective: "Delete file",
          type: "modify",
          dependencies: [],
          riskLevel: "critical",
          verificationRequired: false,
          status: "pending",
          intent: {
            type: "delete_file",
            target: "temp.txt",
            reason: "Delete file",
            requiresApproval: true,
            estimatedRisk: "critical"
          }
        }
      ]
    });

    await fs.writeFile(path.join(tmpDir, "temp.txt"), "some content");

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-destructive-test",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    expect(deleteCount).toBe(1); // Executed once, NOT automatically retried!
    expect(events.some((e) => e.type === "step_retry_started")).toBe(false);
    expect(events.some((e) => e.type === "plan_blocked")).toBe(true);
  });

  it("preserves completed step results and halts execution when a subsequent step is blocked", async () => {
    let step1Called = false;
    let step2Called = false;
    let step3Called = false;

    const testTool: Tool = {
      name: "edit_file",
      description: "Edits file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      permissionCategory: "write",
      async execute(args: unknown): Promise<ToolResult> {
        const p = (args as { path?: string })?.path;
        if (p === "file1.txt") {
          step1Called = true;
          return { success: true, output: "file1 done" };
        }
        if (p === "file2.txt") {
          step2Called = true;
          return { success: false, error: { message: "disk error" } };
        }
        if (p === "file3.txt") {
          step3Called = true;
          return { success: true, output: "file3 done" };
        }
        return { success: true };
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
      retryPolicy: new DefaultStepRetryPolicy({ maxAttempts: 1 })
    });

    const plan = createTaskPlan({
      planId: "plan-partial-test",
      runId: "run-partial-test",
      userRequestSummary: "3 step workflow",
      objective: "Run 3 steps",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Modify file1",
          objective: "Step 1",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          intent: {
            type: "modify_file",
            target: "file1.txt",
            reason: "Edit 1",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Modify file2",
          objective: "Step 2",
          type: "modify",
          dependencies: ["step-1"],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          intent: {
            type: "modify_file",
            target: "file2.txt",
            reason: "Edit 2",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        },
        {
          stepId: "step-3",
          order: 3,
          title: "Modify file3",
          objective: "Step 3",
          type: "modify",
          dependencies: ["step-2"],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          intent: {
            type: "modify_file",
            target: "file3.txt",
            reason: "Edit 3",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    await fs.writeFile(path.join(tmpDir, "file1.txt"), "c1");
    await fs.writeFile(path.join(tmpDir, "file2.txt"), "c2");
    await fs.writeFile(path.join(tmpDir, "file3.txt"), "c3");

    const events: AgentEvent[] = [];
    for await (const ev of planExecutor.executePlan(plan, {
      runId: "run-partial-test",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    expect(step1Called).toBe(true);
    expect(step2Called).toBe(true);
    expect(step3Called).toBe(false); // Step 3 must NOT run!
    expect(events.some((e) => e.type === "plan_step_completed" && e.stepId === "step-1")).toBe(true);
    expect(events.some((e) => e.type === "plan_blocked")).toBe(true);
  });
});

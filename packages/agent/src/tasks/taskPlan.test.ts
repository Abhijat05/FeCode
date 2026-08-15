import { describe, it, expect } from "vitest";
import {
  createTaskPlan,
  startTaskStep,
  completeTaskStep,
  failTaskStep,
  skipTaskStep,
  replanTask
} from "./taskPlan.js";
import { AgentRuntime } from "../runtime.js";
import type { AgentEvent } from "../index.js";
import type { ModelProvider, ModelRequest, ModelEvent, Tool, PermissionDecision } from "@fecode/models";
import type { Skill } from "../skills/types.js";

class MockModelProvider implements ModelProvider {
  public id = "mock-provider";
  public capabilities = {
    streaming: true,
    toolCalling: false,
    vision: false,
    maxContextTokens: 4096
  };

  public capturedRequests: ModelRequest[] = [];

  async *generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    void signal;
    this.capturedRequests.push(request);
    yield { type: "text_delta", content: "Task completed." };
    yield { type: "completed" };
  }
}

describe("TaskPlan Model", () => {
  it("creation: creates a well-structured TaskPlan with default pending states", () => {
    const plan = createTaskPlan("Refactor auth system", [
      "Inspect auth components",
      "Update auth service",
      "Run tests"
    ]);

    expect(plan.id).toMatch(/^plan-/);
    expect(plan.goal).toBe("Refactor auth system");
    expect(plan.steps).toHaveLength(3);
    expect(plan.status).toBe("pending");
    expect(plan.currentStep).toBe(0);

    expect(plan.steps[0]).toEqual({
      id: "step-1",
      description: "Inspect auth components",
      status: "pending",
      dependencies: undefined
    });
  });

  it("status transitions: progresses from pending -> in_progress -> completed", () => {
    let plan = createTaskPlan("Fix bug", ["Step 1", "Step 2"]);

    // Start Step 1
    plan = startTaskStep(plan, "step-1");
    expect(plan.steps[0].status).toBe("in_progress");
    expect(plan.status).toBe("in_progress");
    expect(plan.currentStep).toBe(0);

    // Complete Step 1
    plan = completeTaskStep(plan, "step-1");
    expect(plan.steps[0].status).toBe("completed");
    expect(plan.status).toBe("in_progress"); // plan not yet fully done

    // Start Step 2
    plan = startTaskStep(plan, "step-2");
    expect(plan.steps[1].status).toBe("in_progress");
    expect(plan.currentStep).toBe(1);

    // Complete Step 2
    plan = completeTaskStep(plan, "step-2");
    expect(plan.steps[1].status).toBe("completed");
    expect(plan.status).toBe("completed"); // all steps done
  });

  it("failure transition: marks step and plan as failed with error details", () => {
    let plan = createTaskPlan("Build feature", ["Step 1", "Step 2"]);
    plan = startTaskStep(plan, 0);
    plan = failTaskStep(plan, 0, "Syntax error in component");

    expect(plan.steps[0].status).toBe("failed");
    expect(plan.steps[0].error).toBe("Syntax error in component");
    expect(plan.status).toBe("failed");
  });

  it("skip transition: skips step safely", () => {
    let plan = createTaskPlan("Update styles", ["Step 1", "Step 2"]);
    plan = skipTaskStep(plan, "step-1");
    expect(plan.steps[0].status).toBe("skipped");

    plan = startTaskStep(plan, "step-2");
    plan = completeTaskStep(plan, "step-2");
    expect(plan.status).toBe("completed");
  });

  it("replanning: preserves completed steps and replaces pending steps with new plan", () => {
    let plan = createTaskPlan("Original Goal", [
      "Inspect files",
      "Modify header",
      "Run tests"
    ]);

    plan = startTaskStep(plan, "step-1");
    plan = completeTaskStep(plan, "step-1");

    // Replan after discovering header is generated
    plan = replanTask(plan, [
      "Inspect generator component",
      "Modify generator template",
      "Run tests"
    ]);

    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[0].status).toBe("completed");
    expect(plan.steps[0].description).toBe("Inspect files");

    expect(plan.steps[1].description).toBe("Inspect generator component");
    expect(plan.steps[1].status).toBe("pending");
    expect(plan.steps[2].description).toBe("Modify generator template");
    expect(plan.steps[3].description).toBe("Run tests");
  });
});

describe("Task Planning Runtime & Execution Integration", () => {
  it("Execution: planned tool executions strictly flow through PermissionManager and ToolExecutor", async () => {
    const provider = new MockModelProvider();
    let approvalCount = 0;
    let executionCount = 0;

    let turn = 0;
    provider.generate = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "write_file",
            arguments: { path: "src/auth.ts", content: "export const auth = true;" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Auth updated." };
        yield { type: "completed" };
      }
    };

    const mockTool: Tool = {
      name: "write_file",
      description: "Write file",
      permissionCategory: "write",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        executionCount++;
        return { success: true };
      }
    };

    const toolRegistry = {
      get: () => mockTool,
      list: () => [mockTool],
      register: () => {},
      has: () => true
    };

    const permissionManager = {
      check: async (): Promise<PermissionDecision> => {
        approvalCount++;
        return {
          type: "requires_approval",
          reason: "File modification requires approval"
        };
      }
    };

    const approvalResolver = {
      resolve: async () => ({ approved: true })
    };

    const runtime = new AgentRuntime(provider, {
      registry: toolRegistry,
      permissionManager,
      approvalResolver
    });

    const plan = createTaskPlan("Update Auth", ["Step 1: Write auth.ts"]);
    runtime.setPlan(plan);

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({ message: "Execute step 1", cwd: "/test" })) {
      events.push(event);
    }

    expect(approvalCount).toBe(1);
    expect(executionCount).toBe(1);
    expect(events.some((e) => e.type === "approval_required")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
  });

  it("Permissions: Planning cannot bypass approval when user denies permission", async () => {
    const provider = new MockModelProvider();
    let executionCount = 0;

    let turn = 0;
    provider.generate = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "execute_command",
            arguments: { command: "rm -rf /" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Stopped." };
        yield { type: "completed" };
      }
    };

    const mockTool: Tool = {
      name: "execute_command",
      description: "Run command",
      permissionCategory: "execute",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        executionCount++;
        return { success: true };
      }
    };

    const toolRegistry = {
      get: () => mockTool,
      list: () => [mockTool],
      register: () => {},
      has: () => true
    };

    const permissionManager = {
      check: async (): Promise<PermissionDecision> => ({
        type: "requires_approval",
        reason: "Dangerous command"
      })
    };

    const approvalResolver = {
      resolve: async () => ({ approved: false, reason: "User denied execution." })
    };

    const runtime = new AgentRuntime(provider, {
      registry: toolRegistry,
      permissionManager,
      approvalResolver
    });

    const plan = createTaskPlan("Execute Command", ["Step 1: Run command"]);
    runtime.setPlan(plan);

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({ message: "Run command", cwd: "/test" })) {
      events.push(event);
    }

    expect(executionCount).toBe(0);
    const toolResultEvent = events.find((e) => e.type === "tool_result") as
      | { type: "tool_result"; result: { success: boolean; error?: { message: string } } }
      | undefined;
    expect(toolResultEvent).toBeDefined();
    expect(toolResultEvent?.result.success).toBe(false);
  });

  it("Cancellation: Cancels in-progress task plan step upon runtime cancellation", async () => {
    const provider = new MockModelProvider();

    provider.generate = async function* (_req: ModelRequest, signal?: AbortSignal) {
      yield { type: "text_delta", content: "Starting step..." };
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (signal?.aborted) {
        yield { type: "error", error: new Error("Request aborted") };
        return;
      }
      yield { type: "completed" };
    };

    const runtime = new AgentRuntime(provider);
    let plan = createTaskPlan("Long Task", ["Step 1: Long processing"]);
    plan = startTaskStep(plan, 0);
    runtime.setPlan(plan);

    const runPromise = (async () => {
      const events: AgentEvent[] = [];
      for await (const event of runtime.run({ message: "Start task", cwd: "/test" })) {
        events.push(event);
      }
      return events;
    })();

    await new Promise((resolve) => setTimeout(resolve, 10));
    await runtime.cancel();
    await runPromise;

    const currentPlan = runtime.getPlan();
    expect(currentPlan).toBeDefined();
    expect(currentPlan?.status).toBe("failed");
    expect(currentPlan?.steps[0].status).toBe("failed");
    expect(currentPlan?.steps[0].error).toBe("Cancelled");
  });

  it("Skills: Active skills remain dynamic per turn and are not permanently attached to TaskPlan", async () => {
    const provider = new MockModelProvider();

    const dummySkill1: Skill = {
      name: "react",
      version: "1.0.0",
      category: "framework",
      description: "React guidelines",
      instructions: ["Use hooks properly"]
    };

    const dummySkill2: Skill = {
      name: "frontend-testing",
      version: "1.0.0",
      category: "testing",
      description: "Testing guidelines",
      instructions: ["Write tests"]
    };

    const skillRegistry = {
      list: () => [dummySkill1, dummySkill2],
      register: () => {},
      get: (n: string) => (n === "react" ? dummySkill1 : dummySkill2),
      has: () => true
    };

    const activationPolicy = {
      activate: (msg: string) => {
        if (msg.includes("test")) return { skills: [dummySkill2] };
        return { skills: [dummySkill1] };
      }
    };

    const runtime = new AgentRuntime(provider, {
      skillRegistry,
      activationPolicy: activationPolicy as unknown as import("../skills/activation.js").SkillActivationPolicy
    });

    const plan = createTaskPlan("Full Feature", [
      "Step 1: Write React Component",
      "Step 2: Write Tests"
    ]);
    runtime.setPlan(plan);

    // Turn 1 (React)
    for await (const event of runtime.run({ message: "Write React Component", cwd: "/test" })) {
      void event;
    }
    expect(provider.capturedRequests[0].system).toContain("### Skill: react");
    expect(provider.capturedRequests[0].system).not.toContain("### Skill: frontend-testing");

    // Turn 2 (Testing)
    for await (const event of runtime.run({ message: "Run the tests", cwd: "/test" })) {
      void event;
    }
    expect(provider.capturedRequests[1].system).toContain("### Skill: frontend-testing");
    expect(provider.capturedRequests[1].system).not.toContain("### Skill: react");
  });

  it("Provider Independence: OpenAI, Gemini, Ollama receive equivalent prompt context without TaskPlan leakage", async () => {
    const providerA = new MockModelProvider();
    providerA.id = "openai:gpt-4o";
    const providerB = new MockModelProvider();
    providerB.id = "gemini:gemini-2.5-flash";
    const providerC = new MockModelProvider();
    providerC.id = "ollama:llama3";

    const runtimeA = new AgentRuntime(providerA);
    const runtimeB = new AgentRuntime(providerB);
    const runtimeC = new AgentRuntime(providerC);

    const plan = createTaskPlan("Multi-step Goal", ["Step 1", "Step 2"]);
    runtimeA.setPlan(plan);
    runtimeB.setPlan(plan);
    runtimeC.setPlan(plan);

    for await (const event of runtimeA.run({ message: "Hello", cwd: "/test" })) {
      void event;
    }
    for await (const event of runtimeB.run({ message: "Hello", cwd: "/test" })) {
      void event;
    }
    for await (const event of runtimeC.run({ message: "Hello", cwd: "/test" })) {
      void event;
    }

    expect(providerA.capturedRequests[0].system).toBe(providerB.capturedRequests[0].system);
    expect(providerB.capturedRequests[0].system).toBe(providerC.capturedRequests[0].system);
  });
});

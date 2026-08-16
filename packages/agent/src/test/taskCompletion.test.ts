import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createReactTsFixture,
  type E2EFixture
} from "./e2eFixtures.js";
import { AgentRuntime } from "../runtime.js";
import { DefaultRepositoryExplorer } from "../exploration/explorer.js";
import { DefaultCodeContextSelector } from "../context/selector.js";
import { DefaultAgentExecutionStrategy } from "../strategy/executionStrategy.js";
import { DefaultSkillRegistry } from "../skills/registry.js";
import { SkillActivationPolicy } from "../skills/activation.js";
import { BUILTIN_SKILLS } from "../skills/builtins/index.js";
import { ProjectDetector } from "../project/detector.js";
import { EditFileTool } from "../tools/editFile.js";
import { WriteFileTool } from "../tools/writeFile.js";
import { ReadFileTool } from "../tools/readFile.js";
import { SearchFilesTool } from "../tools/searchFiles.js";
import { ListDirectoryTool } from "../tools/listDirectory.js";
import { ExecuteCommandTool } from "../commands/executeCommandTool.js";
import { MockCommandExecutor } from "../commands/mockExecutor.js";
import { createTaskPlan, completeTaskStep } from "../tasks/taskPlan.js";
import {
  DefaultToolRegistry,
  type ModelProvider,
  type ModelRequest,
  type ModelEvent,
  type ApprovalResolver,
  type PermissionManager
} from "@fecode/models";
import type { TaskCompletionSummary } from "../completion/types.js";

class MockProvider implements ModelProvider {
  public id = "mock-provider";
  public capabilities = {
    streaming: true,
    toolCalling: true,
    vision: false,
    maxContextTokens: 8192
  };

  public capturedRequests: ModelRequest[] = [];
  public generateHandler?: (
    request: ModelRequest,
    signal?: AbortSignal
  ) => AsyncIterable<ModelEvent>;

  async *generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    this.capturedRequests.push(request);
    if (this.generateHandler) {
      yield* this.generateHandler(request, signal);
    } else {
      yield { type: "text_delta", content: "Completed request." };
      yield { type: "completed" };
    }
  }
}

describe("FeCode Phase 4L — Autonomous Task Completion", () => {
  let fixture: E2EFixture;

  beforeEach(async () => {
    fixture = await createReactTsFixture();
  });

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup();
    }
  });

  async function createRuntime(
    provider: ModelProvider,
    cwd: string,
    overrides: {
      approvalResolver?: ApprovalResolver;
      mockExecutor?: MockCommandExecutor;
      maxVerificationAttempts?: number;
      permissionManager?: PermissionManager;
    } = {}
  ) {
    const registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new ListDirectoryTool());
    registry.register(new SearchFilesTool());
    registry.register(new WriteFileTool());
    registry.register(new EditFileTool());

    const mockExecutor = overrides.mockExecutor || new MockCommandExecutor();
    registry.register(new ExecuteCommandTool(mockExecutor));

    const detector = new ProjectDetector();
    const projectContext = await detector.detect(cwd);

    const skillRegistry = new DefaultSkillRegistry();
    for (const skill of BUILTIN_SKILLS) {
      skillRegistry.register(skill);
    }

    const defaultPermissionManager: PermissionManager = {
      check: async (tool) => {
        if (tool.permissionCategory === "write" || tool.permissionCategory === "execute") {
          return { type: "requires_approval", reason: `${tool.name} requires approval` };
        }
        return { type: "allowed" };
      }
    };

    return new AgentRuntime(provider, {
      registry,
      projectContext,
      skillRegistry,
      activationPolicy: new SkillActivationPolicy(),
      repositoryExplorer: new DefaultRepositoryExplorer(),
      codeContextSelector: new DefaultCodeContextSelector(),
      executionStrategy: new DefaultAgentExecutionStrategy(),
      permissionManager: overrides.permissionManager || defaultPermissionManager,
      approvalResolver: overrides.approvalResolver || {
        resolve: async () => ({ approved: true })
      },
      maxVerificationAttempts: overrides.maxVerificationAttempts
    });
  }

  // 1. Simple Task Completion
  it("Simple Task: edit -> approval -> verification -> completed summary", async () => {
    const provider = new MockProvider();
    const mockExecutor = new MockCommandExecutor();
    mockExecutor.defaultResult = { stdout: "PASS: all tests passed", exitCode: 0 };

    let turn = 0;
    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: "src/components/LoginButton.tsx",
              oldText: '{loading ? "Loading..." : "Login"}',
              newText: '{loading ? "Loading..." : "Sign in"}'
            }
          }
        };
        yield { type: "completed" };
      } else if (turn === 2) {
        yield {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "execute_command",
            arguments: { command: "npm test" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Task is completely finished." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath, { mockExecutor });
    let finalSummary: TaskCompletionSummary | undefined;

    for await (const event of runtime.run({
      message: "Change Login to Sign in.",
      cwd: fixture.dirPath
    })) {
      if (event.type === "task_summary") {
        finalSummary = event.summary;
      }
    }

    expect(finalSummary).toBeDefined();
    expect(finalSummary?.status).toBe("completed");
    expect(finalSummary?.completedFiles).toContain("src/components/LoginButton.tsx");
    expect(finalSummary?.verifiedCommands).toContain("npm test");
  });

  // 2. Complex Task Completion with TaskPlan
  it("Complex Task: tracks multiple plan steps and marks completed when all steps finish", async () => {
    const provider = new MockProvider();
    const mockExecutor = new MockCommandExecutor();
    mockExecutor.defaultResult = { stdout: "✓ vitest passed", exitCode: 0 };

    const plan = createTaskPlan("Add authentication with tests", [
      "Update LoginButton UI",
      "Verify with tests"
    ]);

    let turn = 0;
    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        runtime.setPlan(completeTaskStep(runtime.getPlan()!, 0));
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: "src/components/LoginButton.tsx",
              oldText: '{loading ? "Loading..." : "Login"}',
              newText: '{loading ? "Loading..." : "Sign in"}'
            }
          }
        };
        yield { type: "completed" };
      } else if (turn === 2) {
        runtime.setPlan(completeTaskStep(runtime.getPlan()!, 1));
        yield {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "execute_command",
            arguments: { command: "npm test" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "All complex steps done." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath, { mockExecutor });
    runtime.setPlan(plan);

    let summary: TaskCompletionSummary | undefined;
    for await (const event of runtime.run({
      message: "Add authentication with tests",
      cwd: fixture.dirPath
    })) {
      if (event.type === "task_summary") {
        summary = event.summary;
      }
    }

    expect(summary?.status).toBe("completed");
    expect(summary?.completedFiles).toContain("src/components/LoginButton.tsx");
    expect(summary?.verifiedCommands).toContain("npm test");
  });

  // 3. Permission Denial -> Blocked Task
  it("Permission Denial: marks task blocked when required edit is denied", async () => {
    const provider = new MockProvider();
    const approvalResolver: ApprovalResolver = {
      resolve: async () => ({ approved: false, reason: "Security violation" })
    };

    let turn = 0;
    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: "src/components/LoginButton.tsx",
              oldText: '{loading ? "Loading..." : "Login"}',
              newText: '{loading ? "Loading..." : "Sign in"}'
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Cannot proceed due to permission denial." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath, { approvalResolver });
    let summary: TaskCompletionSummary | undefined;

    for await (const event of runtime.run({
      message: "Change Login button text",
      cwd: fixture.dirPath
    })) {
      if (event.type === "task_summary") {
        summary = event.summary;
      }
    }

    expect(summary?.status).toBe("blocked");
    expect(summary?.blockedReason).toContain("Security violation");
  });

  // 4. Verification Failure & Fix Turn
  it("Verification Failure & Recovery: fails verification first, fixes bug, and completes", async () => {
    const provider = new MockProvider();
    const mockExecutor = new MockCommandExecutor();

    let execCount = 0;
    mockExecutor.execute = async (command) => {
      execCount++;
      if (execCount === 1) {
        return {
          command,
          stdout: "",
          stderr: "FAIL: button text mismatch",
          exitCode: 1,
          timedOut: false,
          truncated: false
        };
      }
      return {
        command,
        stdout: "PASS: all tests passed",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        truncated: false
      };
    };

    let turn = 0;
    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        // Edit 1
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: "src/components/LoginButton.tsx",
              oldText: '{loading ? "Loading..." : "Login"}',
              newText: '{loading ? "Loading..." : "Wrong Text"}'
            }
          }
        };
        yield { type: "completed" };
      } else if (turn === 2) {
        // Run test (fails)
        yield {
          type: "tool_call",
          call: { id: "call-2", name: "execute_command", arguments: { command: "npm test" } }
        };
        yield { type: "completed" };
      } else if (turn === 3) {
        // Targeted fix
        yield {
          type: "tool_call",
          call: {
            id: "call-3",
            name: "edit_file",
            arguments: {
              path: "src/components/LoginButton.tsx",
              oldText: '{loading ? "Loading..." : "Wrong Text"}',
              newText: '{loading ? "Loading..." : "Sign in"}'
            }
          }
        };
        yield { type: "completed" };
      } else if (turn === 4) {
        // Re-run test (passes)
        yield {
          type: "tool_call",
          call: { id: "call-4", name: "execute_command", arguments: { command: "npm test" } }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Verification succeeded after fix." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath, { mockExecutor });
    let summary: TaskCompletionSummary | undefined;

    for await (const event of runtime.run({
      message: "Update Login button and verify",
      cwd: fixture.dirPath
    })) {
      if (event.type === "task_summary") {
        summary = event.summary;
      }
    }

    expect(summary?.status).toBe("completed");
    expect(summary?.verifiedCommands).toContain("npm test");
  });

  // 5. Maximum Verification Attempts Limit -> Blocked
  it("Maximum Verification Attempts: marks task blocked when limit is reached", async () => {
    const provider = new MockProvider();
    const mockExecutor = new MockCommandExecutor();
    mockExecutor.defaultResult = { stdout: "", stderr: "FAIL: compiler error", exitCode: 1 };

    let turn = 0;
    provider.generateHandler = async function* () {
      turn++;
      if (turn <= 2) {
        yield {
          type: "tool_call",
          call: { id: `call-${turn}`, name: "execute_command", arguments: { command: "npm test" } }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Max attempts reached, stopping." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath, {
      mockExecutor,
      maxVerificationAttempts: 2
    });

    let summary: TaskCompletionSummary | undefined;
    for await (const event of runtime.run({
      message: "Run tests and retry",
      cwd: fixture.dirPath
    })) {
      if (event.type === "task_summary") {
        summary = event.summary;
      }
    }

    expect(summary?.status).toBe("blocked");
    expect(summary?.blockedReason).toContain("Verification failed after 2 attempts");
  });

  // 6. No-Op Request
  it("No-Op Request: detects requested state already exists without proposing unnecessary edits", async () => {
    const provider = new MockProvider();
    let turn = 0;

    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        // Read file to inspect
        yield {
          type: "tool_call",
          call: { id: "call-1", name: "read_file", arguments: { path: "src/components/LoginButton.tsx" } }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "The LoginButton component already renders the button." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath);
    let summary: TaskCompletionSummary | undefined;

    for await (const event of runtime.run({
      message: "Make sure LoginButton exists",
      cwd: fixture.dirPath
    })) {
      if (event.type === "task_summary") {
        summary = event.summary;
      }
    }

    const finalSummary = summary || runtime.getCompletionSummary();
    expect(finalSummary.status).toBe("completed");
    // No edits made
    expect(finalSummary.completedFiles).toHaveLength(0);
  });

  // 7. Multi-Turn Continuation
  it("Multi-Turn Continuation: preserves history and refreshes context across consecutive tasks", async () => {
    const provider = new MockProvider();
    const runtime = await createRuntime(provider, fixture.dirPath);

    // Turn 1
    let t1 = 0;
    provider.generateHandler = async function* () {
      t1++;
      if (t1 === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: "src/components/LoginButton.tsx",
              oldText: '{loading ? "Loading..." : "Login"}',
              newText: '{loading ? "Loading..." : "Sign in"}'
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Updated button text." };
        yield { type: "completed" };
      }
    };

    for await (const event of runtime.run({
      message: "Change Login to Sign in",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    // Turn 2 continuation
    let t2 = 0;
    provider.generateHandler = async function* () {
      t2++;
      if (t2 === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "edit_file",
            arguments: {
              path: "src/pages/DashboardPage.tsx",
              oldText: "<h1>Dashboard Overview</h1>",
              newText: "<h1>Portal Dashboard</h1>"
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Updated dashboard heading." };
        yield { type: "completed" };
      }
    };

    let secondSummary: TaskCompletionSummary | undefined;
    for await (const event of runtime.run({
      message: "Now also update the dashboard title to Portal Dashboard",
      cwd: fixture.dirPath
    })) {
      if (event.type === "task_summary") {
        secondSummary = event.summary;
      }
    }

    expect(secondSummary?.status).toBe("completed");
    expect(secondSummary?.completedFiles).toContain("src/pages/DashboardPage.tsx");
    // Turn 2 does not report LoginButton as modified in turn 2
    expect(secondSummary?.completedFiles).not.toContain("src/components/LoginButton.tsx");
  });

  // 8. Cancellation
  it("Cancellation: reports cancelled status without claiming completion", async () => {
    const provider = new MockProvider();
    provider.generateHandler = async function* (req, signal) {
      if (signal?.aborted) {
        throw new Error("Aborted");
      }
      yield { type: "text_delta", content: "Working..." };
      await new Promise((r) => setTimeout(r, 50));
      yield { type: "completed" };
    };

    const runtime = await createRuntime(provider, fixture.dirPath);
    setTimeout(() => {
      runtime.cancel();
    }, 5);

    let summary: TaskCompletionSummary | undefined;
    for await (const event of runtime.run({
      message: "Cancel this task",
      cwd: fixture.dirPath
    })) {
      if (event.type === "task_summary") {
        summary = event.summary;
      }
    }

    const finalSummary = summary || runtime.getCompletionSummary();
    expect(finalSummary.status).toBe("cancelled");
  });

  // 9. Provider Independence
  it("Provider Independence: OpenAI, Gemini, and Ollama yield equivalent completion summaries", async () => {
    const providerOpenAI = new MockProvider();
    providerOpenAI.id = "openai:gpt-4o";
    const providerGemini = new MockProvider();
    providerGemini.id = "gemini:gemini-2.5-flash";
    const providerOllama = new MockProvider();
    providerOllama.id = "ollama:llama3";

    const runtimeA = await createRuntime(providerOpenAI, fixture.dirPath);
    const runtimeB = await createRuntime(providerGemini, fixture.dirPath);
    const runtimeC = await createRuntime(providerOllama, fixture.dirPath);

    for await (const event of runtimeA.run({ message: "Task", cwd: fixture.dirPath })) {
      void event;
    }
    for await (const event of runtimeB.run({ message: "Task", cwd: fixture.dirPath })) {
      void event;
    }
    for await (const event of runtimeC.run({ message: "Task", cwd: fixture.dirPath })) {
      void event;
    }

    expect(runtimeA.getCompletionSummary().status).toBe("completed");
    expect(runtimeB.getCompletionSummary().status).toBe("completed");
    expect(runtimeC.getCompletionSummary().status).toBe("completed");
  });

  // 10. Partial Completion
  it("Partial Completion: plan with unfinished steps reports in_progress", async () => {
    const provider = new MockProvider();
    const plan = createTaskPlan("Implement multi-step feature", [
      "Implement step 1",
      "Implement step 2"
    ]);

    let turn = 0;
    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        // Complete only step 1
        runtime.setPlan(completeTaskStep(runtime.getPlan()!, 0));
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: "src/components/LoginButton.tsx",
              oldText: '{loading ? "Loading..." : "Login"}',
              newText: '{loading ? "Loading..." : "Sign in"}'
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Step 1 finished, step 2 remains." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath);
    runtime.setPlan(plan);

    let summary: TaskCompletionSummary | undefined;
    for await (const event of runtime.run({
      message: "Start multi-step feature",
      cwd: fixture.dirPath
    })) {
      if (event.type === "task_summary") {
        summary = event.summary;
      }
    }

    expect(summary?.status).toBe("in_progress");
  });
});

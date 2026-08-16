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
import {
  DefaultToolRegistry,
  type ModelProvider,
  type ModelRequest,
  type ModelEvent,
  type ApprovalResolver,
  type PermissionManager
} from "@fecode/models";

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
      yield { type: "text_delta", content: "Task finished." };
      yield { type: "completed" };
    }
  }
}

describe("FeCode Phase 5A — Multi-Task Session & Runtime Reuse", () => {
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

  // 1. Multiple Tasks in Single Session
  it("executes Task 1 (completed) -> Task 2 (completed) -> Task 3 (blocked) -> Task 4 (completed) in sequence", async () => {
    const provider = new MockProvider();
    const mockExecutor = new MockCommandExecutor();
    mockExecutor.defaultResult = { stdout: "PASS", exitCode: 0 };

    let currentApproval = true;
    const approvalResolver: ApprovalResolver = {
      resolve: async () => ({
        approved: currentApproval,
        reason: currentApproval ? undefined : "User rejected edit"
      })
    };

    const runtime = await createRuntime(provider, fixture.dirPath, {
      mockExecutor,
      approvalResolver
    });

    // Task 1: Update LoginButton (Completed)
    currentApproval = true;
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
        yield { type: "text_delta", content: "Task 1 complete." };
        yield { type: "completed" };
      }
    };

    for await (const event of runtime.run({ message: "Task 1", cwd: fixture.dirPath })) {
      void event;
    }
    const sum1 = runtime.getCompletionSummary();
    expect(sum1.status).toBe("completed");
    expect(sum1.completedFiles).toContain("src/components/LoginButton.tsx");

    // Task 2: Update DashboardPage (Completed)
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
              newText: "<h1>Executive Dashboard</h1>"
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Task 2 complete." };
        yield { type: "completed" };
      }
    };

    for await (const event of runtime.run({ message: "Task 2", cwd: fixture.dirPath })) {
      void event;
    }
    const sum2 = runtime.getCompletionSummary();
    expect(sum2.status).toBe("completed");
    expect(sum2.completedFiles).toContain("src/pages/DashboardPage.tsx");
    expect(sum2.completedFiles).not.toContain("src/components/LoginButton.tsx"); // No leak

    // Task 3: User rejects edit (Blocked)
    currentApproval = false;
    let t3 = 0;
    provider.generateHandler = async function* () {
      t3++;
      if (t3 === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-3",
            name: "edit_file",
            arguments: {
              path: "src/utils/auth.ts",
              oldText: "token !== null",
              newText: "token !== undefined"
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Task 3 blocked." };
        yield { type: "completed" };
      }
    };

    for await (const event of runtime.run({ message: "Task 3", cwd: fixture.dirPath })) {
      void event;
    }
    const sum3 = runtime.getCompletionSummary();
    expect(sum3.status).toBe("blocked");

    // Task 4: Another task proceeds and completes without blocked leakage
    currentApproval = true;
    let t4 = 0;
    provider.generateHandler = async function* () {
      t4++;
      if (t4 === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-4",
            name: "execute_command",
            arguments: { command: "npm test" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Task 4 complete." };
        yield { type: "completed" };
      }
    };

    for await (const event of runtime.run({ message: "Task 4", cwd: fixture.dirPath })) {
      void event;
    }
    const sum4 = runtime.getCompletionSummary();
    expect(sum4.status).toBe("completed");
    expect(sum4.verifiedCommands).toContain("npm test");
    expect(sum4.blockedReason).toBeUndefined(); // Blocked state did not leak
  });

  // 2. Clear Context
  it("clear() resets runtime conversation and context without touching filesystem", async () => {
    const provider = new MockProvider();
    const runtime = await createRuntime(provider, fixture.dirPath);

    for await (const event of runtime.run({ message: "Hello", cwd: fixture.dirPath })) {
      void event;
    }
    expect(runtime.getState().messages.length).toBeGreaterThan(0);

    runtime.clear();
    expect(runtime.getState().messages).toHaveLength(0);
    expect(runtime.getState().verificationAttempts).toBe(0);
    expect(runtime.getState().status).toBe("idle");
    expect(runtime.getPlan()).toBeUndefined();
  });
});

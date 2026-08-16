import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  createReactTsFixture,
  type E2EFixture
} from "./e2eFixtures.js";
import { AgentRuntime } from "../runtime.js";
import { DefaultSessionStore } from "../session/store.js";
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
import type { PersistedSessionData } from "../session/types.js";

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
      yield { type: "text_delta", content: "Response" };
      yield { type: "completed" };
    }
  }
}

describe("FeCode Phase 5B — Session Persistence & Resume Integration", () => {
  let fixture: E2EFixture;
  let sessionsDir: string;
  let store: DefaultSessionStore;

  beforeEach(async () => {
    fixture = await createReactTsFixture();
    sessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-int-sessions-"));
    store = new DefaultSessionStore(sessionsDir);
  });

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup();
    }
    if (sessionsDir) {
      await fs.rm(sessionsDir, { recursive: true, force: true });
    }
  });

  async function createRuntime(
    provider: ModelProvider,
    cwd: string,
    overrides: {
      sessionId?: string;
      approvalResolver?: ApprovalResolver;
      mockExecutor?: MockCommandExecutor;
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
      check: async () => ({ type: "allowed" })
    };

    return new AgentRuntime(provider, {
      sessionId: overrides.sessionId,
      registry,
      projectContext,
      skillRegistry,
      activationPolicy: new SkillActivationPolicy(),
      repositoryExplorer: new DefaultRepositoryExplorer(),
      codeContextSelector: new DefaultCodeContextSelector(),
      executionStrategy: new DefaultAgentExecutionStrategy(),
      permissionManager: defaultPermissionManager,
      approvalResolver: overrides.approvalResolver || {
        resolve: async () => ({ approved: true })
      }
    });
  }

  it("persists completed session and restores conversation history into new runtime instance", async () => {
    const provider1 = new MockProvider();
    let turn = 0;
    provider1.generateHandler = async function* () {
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
        yield { type: "text_delta", content: "Updated button text to Sign in." };
        yield { type: "completed" };
      }
    };

    const runtime1 = await createRuntime(provider1, fixture.dirPath, {
      sessionId: "session-persisted-1"
    });

    for await (const event of runtime1.run({
      message: "Change Login to Sign in",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    const summary1 = runtime1.getCompletionSummary();
    const state1 = runtime1.getState();

    const sessionData: PersistedSessionData = {
      version: 1,
      sessionId: "session-persisted-1",
      workingDirectory: fixture.dirPath,
      provider: "gemini",
      model: "gemini-2.5-flash",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      taskCount: 1,
      status: summary1.status,
      completedTaskSummaries: [summary1],
      messages: state1.messages
    };

    await store.save(sessionData);

    // Verify no session files created inside repository workspace
    const repoEntries = await fs.readdir(fixture.dirPath);
    expect(repoEntries).not.toContain(".fecode");
    expect(repoEntries.some((e) => e.endsWith(".json") && e.startsWith("session-"))).toBe(false);

    // Resume session in a brand new runtime instance
    const loadedData = await store.load("session-persisted-1");
    expect(loadedData.sessionId).toBe("session-persisted-1");
    expect(loadedData.taskCount).toBe(1);
    expect(loadedData.messages.length).toBeGreaterThan(0);

    const provider2 = new MockProvider();
    provider2.generateHandler = async function* (req) {
      // Verify restored history is present in prompt request
      expect(req.messages.length).toBeGreaterThan(1);
      yield { type: "text_delta", content: "Understood follow-up." };
      yield { type: "completed" };
    };

    const runtime2 = await createRuntime(provider2, loadedData.workingDirectory, {
      sessionId: loadedData.sessionId
    });

    runtime2.restoreSession(loadedData);
    expect(runtime2.getState().messages.length).toBe(state1.messages.length);

    for await (const event of runtime2.run({
      message: "What did we just change?",
      cwd: loadedData.workingDirectory
    })) {
      void event;
    }

    expect(provider2.capturedRequests.length).toBe(1);
  });
});

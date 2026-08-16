import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createReactTsFixture, type E2EFixture } from "./e2eFixtures.js";
import { AgentRuntime } from "../runtime.js";
import { DefaultRepositoryExplorer } from "../exploration/explorer.js";
import { DefaultCodeContextSelector } from "../context/selector.js";
import { ProjectDetector } from "../project/detector.js";
import { ReadFileTool } from "../tools/readFile.js";
import { ListDirectoryTool } from "../tools/listDirectory.js";
import { EditFileTool } from "../tools/editFile.js";
import { DefaultAgentExecutionStrategy } from "../strategy/executionStrategy.js";
import { ExecuteCommandTool } from "../commands/executeCommandTool.js";
import { MockCommandExecutor } from "../commands/mockExecutor.js";
import { DefaultToolRegistry, GeminiModelProvider } from "@fecode/models";

const apiKey = process.env.GEMINI_API_KEY;
const isLiveTestEnabled = Boolean(apiKey && apiKey.trim().length > 0);

describe.skipIf(!isLiveTestEnabled)("Scenario N — Real Gemini Smoke Test (Opt-in)", () => {
  let fixture: E2EFixture;

  beforeEach(async () => {
    fixture = await createReactTsFixture();
  });

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup();
    }
  });

  it("Live Gemini: read scenario", async () => {
    if (!apiKey) return;
    const provider = new GeminiModelProvider({
      apiKey,
      model: "gemini-2.5-flash"
    });

    const registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new ListDirectoryTool());

    const detector = new ProjectDetector();
    const projectContext = await detector.detect(fixture.dirPath);

    const runtime = new AgentRuntime(provider, {
      registry,
      projectContext,
      repositoryExplorer: new DefaultRepositoryExplorer(),
      codeContextSelector: new DefaultCodeContextSelector(),
      executionStrategy: new DefaultAgentExecutionStrategy()
    });

    const events = [];
    for await (const event of runtime.run({
      message: "Explain what DashboardPage.tsx renders.",
      cwd: fixture.dirPath
    })) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents.length).toBeGreaterThan(0);
  });

  it("Live Gemini: edit scenario", async () => {
    if (!apiKey) return;
    const provider = new GeminiModelProvider({
      apiKey,
      model: "gemini-2.5-flash"
    });

    const registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new EditFileTool());

    const detector = new ProjectDetector();
    const projectContext = await detector.detect(fixture.dirPath);

    const runtime = new AgentRuntime(provider, {
      registry,
      projectContext,
      repositoryExplorer: new DefaultRepositoryExplorer(),
      codeContextSelector: new DefaultCodeContextSelector(),
      executionStrategy: new DefaultAgentExecutionStrategy(),
      permissionManager: { check: async () => ({ type: "allowed" }) },
      approvalResolver: { resolve: async () => ({ approved: true }) }
    });

    const events = [];
    for await (const event of runtime.run({
      message: "Change the LoginButton text from Login to Sign In in src/components/LoginButton.tsx",
      cwd: fixture.dirPath
    })) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
  });

  it("Live Gemini: verification scenario", async () => {
    if (!apiKey) return;
    const provider = new GeminiModelProvider({
      apiKey,
      model: "gemini-2.5-flash"
    });

    const registry = new DefaultToolRegistry();
    const mockExecutor = new MockCommandExecutor();
    mockExecutor.defaultResult = {
      stdout: "✓ 2 tests passed",
      stderr: "",
      exitCode: 0
    };
    registry.register(new ExecuteCommandTool(mockExecutor));

    const detector2 = new ProjectDetector();
    const projectContext = await detector2.detect(fixture.dirPath);

    const runtime = new AgentRuntime(provider, {
      registry,
      projectContext,
      repositoryExplorer: new DefaultRepositoryExplorer(),
      codeContextSelector: new DefaultCodeContextSelector(),
      executionStrategy: new DefaultAgentExecutionStrategy(),
      permissionManager: { check: async () => ({ type: "allowed" }) },
      approvalResolver: { resolve: async () => ({ approved: true }) }
    });

    const events = [];
    for await (const event of runtime.run({
      message: "Run the tests for the project.",
      cwd: fixture.dirPath
    })) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
  });
});

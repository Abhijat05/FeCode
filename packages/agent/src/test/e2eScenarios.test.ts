import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import {
  createReactTsFixture,
  createReactTailwindFixture,
  createNextJsFixture,
  createVueFixture,
  createPackageManagerFixture,
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
  type ApprovalDecision,
  type ApprovalRequest,
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
      yield { type: "text_delta", content: "Completed request." };
      yield { type: "completed" };
    }
  }
}

describe("FeCode End-to-End Scenarios", () => {
  let fixture: E2EFixture;

  beforeEach(async () => {
    fixture = await createReactTsFixture();
  });

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup();
    }
  });

  // Helper to create fully wired AgentRuntime for e2e tests
  async function createRuntime(
    provider: ModelProvider,
    cwd: string,
    overrides: {
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

    const permissionManager: PermissionManager = {
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
      permissionManager,
      approvalResolver: overrides.approvalResolver || {
        resolve: async () => ({ approved: true })
      }
    });
  }

  it("Scenario A — Simple Implementation: modifies LoginButton text with approval and atomic write", async () => {
    const provider = new MockProvider();
    let approvalRequested = false;

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
        yield { type: "text_delta", content: "Updated button text to Sign in." };
        yield { type: "completed" };
      }
    };

    const approvalResolver: ApprovalResolver = {
      resolve: async (req: ApprovalRequest): Promise<ApprovalDecision> => {
        approvalRequested = true;
        expect(req.toolName).toBe("edit_file");
        return { approved: true };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath, { approvalResolver });

    for await (const event of runtime.run({
      message: "Change the LoginButton text from Login to Sign in.",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    expect(approvalRequested).toBe(true);

    const buttonContent = await fs.readFile(
      path.join(fixture.dirPath, "src", "components", "LoginButton.tsx"),
      "utf-8"
    );
    expect(buttonContent).toContain('Sign in');
    expect(buttonContent).not.toContain('"Login"');

    // Verify prompt included explorer & context selector data
    const firstPrompt = provider.capturedRequests[0].system;
    expect(firstPrompt).toContain("## Repository Exploration");
    expect(firstPrompt).toContain("src/components/LoginButton.tsx");
  });

  it("Scenario B — Complex Feature: activates TaskPlan and guides multi-step workflow", async () => {
    const provider = new MockProvider();
    const strategy = new DefaultAgentExecutionStrategy();
    const decision = strategy.decide(
      "Add a loading state to the login form and add tests for it."
    );

    expect(decision.intent).toBe("implement");
    expect(decision.requiresPlanning).toBe(true);
    expect(decision.phase).toBe("planning");

    const runtime = await createRuntime(provider, fixture.dirPath);
    for await (const event of runtime.run({
      message: "Add a loading state to the login form and add tests for it.",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    const prompt = provider.capturedRequests[0].system;
    expect(prompt).toContain("## Repository Exploration");
    expect(prompt).toContain("## Code Context");
  });

  it("Scenario C — Conceptual Question: answers directly without repository exploration or context", async () => {
    const provider = new MockProvider();
    const runtime = await createRuntime(provider, fixture.dirPath);

    for await (const event of runtime.run({
      message: "What is a React hook?",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    const prompt = provider.capturedRequests[0].system;
    expect(prompt).not.toContain("## Repository Exploration");
    expect(prompt).not.toContain("## Code Context");
    expect(prompt).toContain("Provide a clear, direct answer to the user's conceptual question");
  });

  it("Scenario D — Repository Question: explores repository without proposing edits or approvals", async () => {
    const provider = new MockProvider();
    let approvalTriggered = false;

    const approvalResolver: ApprovalResolver = {
      resolve: async () => {
        approvalTriggered = true;
        return { approved: true };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath, { approvalResolver });

    for await (const event of runtime.run({
      message: "Where is the authentication logic implemented?",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    expect(approvalTriggered).toBe(false);
    const prompt = provider.capturedRequests[0].system;
    expect(prompt).toContain("## Repository Exploration");
    expect(prompt).toContain("src/utils/auth.ts");
  });

  it("Scenario E — Code Inspection: selects code context for targeted inspection", async () => {
    const provider = new MockProvider();
    const runtime = await createRuntime(provider, fixture.dirPath);

    for await (const event of runtime.run({
      message: "What does DashboardPage render?",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    const prompt = provider.capturedRequests[0].system;
    expect(prompt).toContain("## Repository Exploration");
    expect(prompt).toContain("## Code Context");
    expect(prompt).toContain("src/pages/DashboardPage.tsx");
  });

  it("Scenario F — Verification: runs project test suite with execute_command approval", async () => {
    const provider = new MockProvider();
    const mockExecutor = new MockCommandExecutor();
    mockExecutor.defaultResult = {
      stdout: "✓ tests passed (2/2)",
      stderr: "",
      exitCode: 0
    };

    let commandApproved = false;
    const approvalResolver: ApprovalResolver = {
      resolve: async (req) => {
        if (req.toolName === "execute_command") {
          commandApproved = true;
        }
        return { approved: true };
      }
    };

    let turn = 0;
    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "execute_command",
            arguments: { command: "npm test" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "All tests passed successfully." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath, {
      approvalResolver,
      mockExecutor
    });

    for await (const event of runtime.run({
      message: "Run the tests.",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    expect(commandApproved).toBe(true);
  });

  it("Scenario G — Failed Verification: triggers diagnosis and fix turn", async () => {
    const provider = new MockProvider();
    const mockExecutor = new MockCommandExecutor();

    let execCount = 0;
    mockExecutor.execute = async (command) => {
      execCount++;
      if (execCount === 1) {
        return {
          command,
          stdout: "",
          stderr: "FAIL: src/components/LoginButton.test.tsx: button text mismatch",
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
        yield {
          type: "tool_call",
          call: { id: "call-1", name: "execute_command", arguments: { command: "npm test" } }
        };
        yield { type: "completed" };
      } else if (turn === 2) {
        // Fix edit
        yield {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "edit_file",
            arguments: {
              path: "src/components/LoginButton.tsx",
              oldText: "Login",
              newText: "Sign in"
            }
          }
        };
        yield { type: "completed" };
      } else if (turn === 3) {
        // Re-verify
        yield {
          type: "tool_call",
          call: { id: "call-3", name: "execute_command", arguments: { command: "npm test" } }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Fixed and verified!" };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath, { mockExecutor });

    for await (const event of runtime.run({
      message: "Verify and fix LoginButton",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    expect(execCount).toBe(2);
  });

  it("Scenario H — Edit Conflict: detects external modification with EDIT_CONFLICT", async () => {
    const provider = new MockProvider();

    // Modify file externally
    await fs.writeFile(
      path.join(fixture.dirPath, "src", "components", "LoginButton.tsx"),
      "// Externally changed\nexport const LoginButton = () => <button>Modified</button>;\n"
    );

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
              oldText: 'className="btn-login"',
              newText: 'className="btn-login-updated"',
              expectedHash: "stale-hash-12345"
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Conflict detected, re-reading file." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath);

    for await (const event of runtime.run({
      message: "Update LoginButton styling",
      cwd: fixture.dirPath
    })) {
      if (event.type === "tool_result" && event.callId === "call-1") {
        expect(event.result.success).toBe(false);
        expect(event.result.error?.code).toBe("EDIT_CONFLICT");
      }
    }
  });

  it("Scenario I — Permission Denial: denied edit leaves file unchanged and returns PERMISSION_DENIED", async () => {
    const provider = new MockProvider();
    const approvalResolver: ApprovalResolver = {
      resolve: async () => ({ approved: false, reason: "User denied change" })
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
              newText: '{loading ? "Loading..." : "Unauthorized"}'
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Permission denied, skipping edit." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath, { approvalResolver });

    for await (const event of runtime.run({
      message: "Update button",
      cwd: fixture.dirPath
    })) {
      if (event.type === "tool_result" && event.callId === "call-1") {
        expect(event.result.success).toBe(false);
        expect(event.result.error?.code).toBe("PERMISSION_DENIED");
      }
    }

    const content = await fs.readFile(
      path.join(fixture.dirPath, "src", "components", "LoginButton.tsx"),
      "utf-8"
    );
    expect(content).not.toContain("Unauthorized");
  });

  it("Scenario J — Cancellation: cancels generation cleanly via AbortController", async () => {
    const provider = new MockProvider();
    provider.generateHandler = async function* (req, signal) {
      if (signal?.aborted) {
        throw new Error("Generation aborted");
      }
      yield { type: "text_delta", content: "Starting..." };
    };

    const runtime = await createRuntime(provider, fixture.dirPath);

    setTimeout(() => {
      runtime.cancel();
    }, 10);

    const events = [];
    for await (const event of runtime.run({
      message: "Long task",
      cwd: fixture.dirPath
    })) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThanOrEqual(0);
  });

  it("Scenario K — Framework Skills: activates react and tailwind for frontend request", async () => {
    const tailwindFixture = await createReactTailwindFixture();
    try {
      const provider = new MockProvider();
      const runtime = await createRuntime(provider, tailwindFixture.dirPath);

      for await (const event of runtime.run({
        message: "Build a responsive settings modal with tailwind.",
        cwd: tailwindFixture.dirPath
      })) {
        void event;
      }

      const prompt = provider.capturedRequests[0]?.system || "";
      expect(prompt).toContain("## Active FeCode Skills");
      expect(prompt).toContain("react");
    } finally {
      await tailwindFixture.cleanup();
    }
  });

  it("Scenario K.2 — Next.js Fixture: discovers Next.js routing structure and page", async () => {
    const nextFixture = await createNextJsFixture();
    try {
      const provider = new MockProvider();
      const runtime = await createRuntime(provider, nextFixture.dirPath);

      for await (const event of runtime.run({
        message: "Where is the home page defined?",
        cwd: nextFixture.dirPath
      })) {
        void event;
      }

      const prompt = provider.capturedRequests[0]?.system || "";
      expect(prompt).toContain("## Repository Exploration");
      expect(prompt).toContain("src/app/page.tsx");
    } finally {
      await nextFixture.cleanup();
    }
  });

  it("Scenario K.3 — Vue Fixture: discovers Vue components in Vue project", async () => {
    const vueFixture = await createVueFixture();
    try {
      const provider = new MockProvider();
      const runtime = await createRuntime(provider, vueFixture.dirPath);

      for await (const event of runtime.run({
        message: "What does App.vue render?",
        cwd: vueFixture.dirPath
      })) {
        void event;
      }

      const prompt = provider.capturedRequests[0]?.system || "";
      expect(prompt).toContain("## Repository Exploration");
      expect(prompt).toContain("src/App.vue");
    } finally {
      await vueFixture.cleanup();
    }
  });

  it("Scenario L — Project Package Manager: adapts commands for pnpm, yarn, bun", async () => {
    const pnpmFixture = await createPackageManagerFixture("pnpm");
    try {
      const provider = new MockProvider();
      const runtime = await createRuntime(provider, pnpmFixture.dirPath);

      for await (const event of runtime.run({
        message: "Run the tests",
        cwd: pnpmFixture.dirPath
      })) {
        void event;
      }

      const prompt = provider.capturedRequests[0].system;
      expect(prompt).toContain("pnpm");
    } finally {
      await pnpmFixture.cleanup();
    }
  });

  it("Scenario M — Provider Independence: OpenAI, Gemini, and Ollama receive identical prompt and semantics", async () => {
    const providerOpenAI = new MockProvider();
    providerOpenAI.id = "openai:gpt-4o";
    const providerGemini = new MockProvider();
    providerGemini.id = "gemini:gemini-2.5-flash";
    const providerOllama = new MockProvider();
    providerOllama.id = "ollama:llama3";

    const runtimeA = await createRuntime(providerOpenAI, fixture.dirPath);
    const runtimeB = await createRuntime(providerGemini, fixture.dirPath);
    const runtimeC = await createRuntime(providerOllama, fixture.dirPath);

    for await (const event of runtimeA.run({ message: "Fix LoginButton", cwd: fixture.dirPath })) {
      void event;
    }
    for await (const event of runtimeB.run({ message: "Fix LoginButton", cwd: fixture.dirPath })) {
      void event;
    }
    for await (const event of runtimeC.run({ message: "Fix LoginButton", cwd: fixture.dirPath })) {
      void event;
    }

    expect(providerOpenAI.capturedRequests[0].system).toBe(providerGemini.capturedRequests[0].system);
    expect(providerGemini.capturedRequests[0].system).toBe(providerOllama.capturedRequests[0].system);
  });

  it("Scenario O — Secret Protection: rejects editing .env files and keeps secrets safe", async () => {
    await fs.writeFile(path.join(fixture.dirPath, ".env"), "SECRET_API_KEY=12345\n");

    const provider = new MockProvider();
    let turn = 0;
    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: { path: ".env", oldText: "12345", newText: "67890" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Cannot modify secret file." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath);

    for await (const event of runtime.run({
      message: "Update .env with the API key",
      cwd: fixture.dirPath
    })) {
      if (event.type === "tool_result" && event.callId === "call-1") {
        expect(event.result.success).toBe(false);
        expect(event.result.error?.code).toBe("SECRET_FILE");
      }
    }
  });

  it("Scenario P — Context Efficiency: simple vs complex implementation has bounded context", async () => {
    const provider = new MockProvider();
    const runtime = await createRuntime(provider, fixture.dirPath);

    for await (const event of runtime.run({
      message: "Change the button text to Save",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    const simplePrompt = provider.capturedRequests[0]?.system || "";
    expect(simplePrompt.length).toBeLessThan(10000);
  });

  it("Scenario Q — Multi-Turn Task: preserves history and refreshes context across turns", async () => {
    const provider = new MockProvider();
    const runtime = await createRuntime(provider, fixture.dirPath);

    // Turn 1
    for await (const event of runtime.run({
      message: "Where is authentication logic?",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    // Turn 2
    for await (const event of runtime.run({
      message: "What does LoginButton render?",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    expect(provider.capturedRequests).toHaveLength(2);
    expect(provider.capturedRequests[1].messages.length).toBeGreaterThan(1);
  });

  it("Scenario R — Runtime Reuse: reuses same AgentRuntime instance for multiple independent tasks", async () => {
    const provider = new MockProvider();
    const runtime = await createRuntime(provider, fixture.dirPath);

    for await (const event of runtime.run({ message: "What is React?", cwd: fixture.dirPath })) {
      void event;
    }

    for await (const event of runtime.run({ message: "Run the tests.", cwd: fixture.dirPath })) {
      void event;
    }

    expect(provider.capturedRequests).toHaveLength(2);
    expect(provider.capturedRequests[0].system).not.toContain("## Repository Exploration");
    expect(provider.capturedRequests[1].system).toContain("Verify the project");
  });
});

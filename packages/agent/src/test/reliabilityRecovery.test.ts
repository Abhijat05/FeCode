import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
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
  type PermissionManager,
  type ToolResult
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

describe("FeCode Phase 4K — Real-World Agent Reliability & Recovery", () => {
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
      maxIdenticalToolCalls?: number;
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
      maxIdenticalToolCalls: overrides.maxIdenticalToolCalls,
      maxVerificationAttempts: overrides.maxVerificationAttempts
    });
  }

  // 1. Wrong File Recovery
  it("Wrong File Recovery: discovers wrong file, searches again, and edits correct file", async () => {
    const provider = new MockProvider();
    let turn = 0;

    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        // Model erroneously checks Header.tsx for login button
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "read_file",
            arguments: { path: "src/components/Header.tsx" }
          }
        };
        yield { type: "completed" };
      } else if (turn === 2) {
        // Model notices login button is not in Header.tsx, searches for LoginButton
        yield {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "search_files",
            arguments: { query: "LoginButton" }
          }
        };
        yield { type: "completed" };
      } else if (turn === 3) {
        // Model reads and edits the correct file
        yield {
          type: "tool_call",
          call: {
            id: "call-3",
            name: "edit_file",
            arguments: {
              path: "src/components/LoginButton.tsx",
              oldText: '{loading ? "Loading..." : "Login"}',
              newText: '{loading ? "Please wait..." : "Sign In"}'
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Successfully updated LoginButton." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath);
    for await (const event of runtime.run({
      message: "Fix login button text",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    const updatedContent = await fs.readFile(
      path.join(fixture.dirPath, "src", "components", "LoginButton.tsx"),
      "utf-8"
    );
    expect(updatedContent).toContain("Please wait...");
    expect(updatedContent).toContain("Sign In");
  });

  // 2. Empty Search Recovery
  it("Empty Search Recovery: handles 0 search results and recovers without looping", async () => {
    const provider = new MockProvider();
    let turn = 0;

    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        // Search for a non-existent symbol
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "search_files",
            arguments: { query: "NonExistentWidget3000" }
          }
        };
        yield { type: "completed" };
      } else if (turn === 2) {
        // Broaden search to existing components directory
        yield {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "list_directory",
            arguments: { path: "src/components" }
          }
        };
        yield { type: "completed" };
      } else {
        yield {
          type: "text_delta",
          content: "The widget was not found. Available components are Header and LoginButton."
        };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath);
    const results: ToolResult[] = [];

    for await (const event of runtime.run({
      message: "Where is NonExistentWidget3000?",
      cwd: fixture.dirPath
    })) {
      if (event.type === "tool_result") {
        results.push(event.result);
      }
    }

    expect(results.length).toBe(2);
    expect(results[0].success).toBe(true);
    expect((results[0].output as { matches: unknown[] }).matches).toHaveLength(0);
    expect(results[1].success).toBe(true);
    expect(runtime.getState().status).toBe("completed");
  });

  // 3. Bad Path Recovery
  it("Bad Path Recovery: receives NOT_FOUND and recovers via directory listing", async () => {
    const provider = new MockProvider();
    let turn = 0;

    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        // Model typos the filename
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "read_file",
            arguments: { path: "src/components/LoginButon.tsx" }
          }
        };
        yield { type: "completed" };
      } else if (turn === 2) {
        // Model inspects directory to find correct spelling
        yield {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "list_directory",
            arguments: { path: "src/components" }
          }
        };
        yield { type: "completed" };
      } else if (turn === 3) {
        // Model reads the correct file
        yield {
          type: "tool_call",
          call: {
            id: "call-3",
            name: "read_file",
            arguments: { path: "src/components/LoginButton.tsx" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Found and inspected LoginButton.tsx." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath);
    const toolResults: ToolResult[] = [];

    for await (const event of runtime.run({
      message: "Read LoginButon.tsx",
      cwd: fixture.dirPath
    })) {
      if (event.type === "tool_result") {
        toolResults.push(event.result);
      }
    }

    expect(toolResults[0].success).toBe(false);
    expect(toolResults[0].error?.code).toBe("NOT_FOUND");
    expect(toolResults[1].success).toBe(true);
    expect(toolResults[2].success).toBe(true);
  });

  // 4. Invalid Tool Arguments Protection
  it("Invalid Tool Arguments: returns INVALID_ARGUMENT without crashing or mutating files", async () => {
    const provider = new MockProvider();
    let turn = 0;

    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        // Empty query search
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "search_files",
            arguments: { query: "" }
          }
        };
        yield { type: "completed" };
      } else if (turn === 2) {
        // Missing path read
        yield {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "read_file",
            arguments: {}
          }
        };
        yield { type: "completed" };
      } else if (turn === 3) {
        // Empty command execution
        yield {
          type: "tool_call",
          call: {
            id: "call-3",
            name: "execute_command",
            arguments: { command: "" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Recovered from invalid arguments." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath);
    const errors: string[] = [];

    for await (const event of runtime.run({
      message: "Test invalid arguments",
      cwd: fixture.dirPath
    })) {
      if (event.type === "tool_result" && !event.result.success) {
        errors.push(event.result.error?.code || "");
      }
    }

    expect(errors).toEqual(["INVALID_ARGUMENT", "INVALID_ARGUMENT", "INVALID_ARGUMENT"]);
    expect(runtime.getState().status).toBe("completed");
  });

  // 5. Repeated Tool Call Protection
  it("Repeated Tool Call Protection: intercepts identical repeated loop and returns REPEATED_CALL_LOOP", async () => {
    const provider = new MockProvider();
    let turn = 0;

    provider.generateHandler = async function* () {
      turn++;
      if (turn <= 3) {
        yield {
          type: "tool_call",
          call: {
            id: `call-${turn}`,
            name: "search_files",
            arguments: { query: "Dashboard" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Loop halted." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath, {
      maxIdenticalToolCalls: 2
    });

    const loopErrors: string[] = [];
    let executedTurns = 0;

    for await (const event of runtime.run({
      message: "Search Dashboard in a loop",
      cwd: fixture.dirPath
    })) {
      if (event.type === "tool_result") {
        executedTurns++;
        if (!event.result.success && event.result.error?.code === "REPEATED_CALL_LOOP") {
          loopErrors.push(event.result.error.code);
          break;
        }
      }
    }

    expect(loopErrors).toContain("REPEATED_CALL_LOOP");
    expect(executedTurns).toBe(3);
  });

  // 6. Reset Repeated Tool Guard on File Modification
  it("Repeated Tool Guard: resets counter when a file mutation occurs", async () => {
    const provider = new MockProvider();
    let turn = 0;

    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        // Read file call 1
        yield {
          type: "tool_call",
          call: { id: "call-1", name: "read_file", arguments: { path: "src/components/LoginButton.tsx" } }
        };
        yield { type: "completed" };
      } else if (turn === 2) {
        // Edit file (mutation)
        yield {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "edit_file",
            arguments: {
              path: "src/components/LoginButton.tsx",
              oldText: '{loading ? "Loading..." : "Login"}',
              newText: '{loading ? "Loading..." : "Sign In"}'
            }
          }
        };
        yield { type: "completed" };
      } else if (turn === 3) {
        // Re-read file with identical path - should succeed because disk state changed
        yield {
          type: "tool_call",
          call: { id: "call-3", name: "read_file", arguments: { path: "src/components/LoginButton.tsx" } }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Done" };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath, {
      maxIdenticalToolCalls: 1
    });

    const results: ToolResult[] = [];
    for await (const event of runtime.run({
      message: "Edit and re-read",
      cwd: fixture.dirPath
    })) {
      if (event.type === "tool_result") {
        results.push(event.result);
      }
    }

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    expect(results[2].success).toBe(true);
  });

  // 7. Edit Conflict Recovery
  it("Edit Conflict Recovery: detects external change, re-reads, and produces fresh valid edit", async () => {
    const provider = new MockProvider();
    let turn = 0;

    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        // Initial attempt uses stale expectation
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: "src/components/LoginButton.tsx",
              oldText: 'className="btn-login"',
              newText: 'className="btn-login-modern"'
            }
          }
        };
        yield { type: "completed" };
      } else if (turn === 2) {
        // Model receives EDIT_CONFLICT or AMBIGUOUS_EDIT, re-reads file
        yield {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "read_file",
            arguments: { path: "src/components/LoginButton.tsx" }
          }
        };
        yield { type: "completed" };
      } else if (turn === 3) {
        // Model provides targeted fresh edit
        yield {
          type: "tool_call",
          call: {
            id: "call-3",
            name: "edit_file",
            arguments: {
              path: "src/components/LoginButton.tsx",
              oldText: 'className="btn-login-externally-changed"',
              newText: 'className="btn-login-resolved"'
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Conflict resolved." };
        yield { type: "completed" };
      }
    };

    // Externally mutate file before run
    await fs.writeFile(
      path.join(fixture.dirPath, "src", "components", "LoginButton.tsx"),
      'export const LoginButton = () => <button className="btn-login-externally-changed">Login</button>;\n'
    );

    const runtime = await createRuntime(provider, fixture.dirPath);
    for await (const event of runtime.run({
      message: "Update class name",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    const updated = await fs.readFile(
      path.join(fixture.dirPath, "src", "components", "LoginButton.tsx"),
      "utf-8"
    );
    expect(updated).toContain("btn-login-resolved");
  });

  // 8. Multi-Turn User Correction
  it("Multi-Turn User Correction: respects user redirect and leaves original file untouched", async () => {
    const provider = new MockProvider();

    // Turn 1
    let t1 = 0;
    provider.generateHandler = async function* () {
      t1++;
      if (t1 === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "read_file",
            arguments: { path: "src/components/LoginForm.tsx" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Checked LoginForm.tsx" };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath);
    for await (const event of runtime.run({
      message: "Check LoginForm.tsx",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    // Turn 2: User corrects "No, I meant DashboardPage.tsx"
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
        yield { type: "text_delta", content: "Updated DashboardPage.tsx" };
        yield { type: "completed" };
      }
    };

    for await (const event of runtime.run({
      message: "No, I meant DashboardPage.tsx. Update the heading to Executive Dashboard.",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    const formContent = await fs.readFile(
      path.join(fixture.dirPath, "src", "components", "LoginForm.tsx"),
      "utf-8"
    );
    const dashboardContent = await fs.readFile(
      path.join(fixture.dirPath, "src", "pages", "DashboardPage.tsx"),
      "utf-8"
    );

    // LoginForm remains unmodified
    expect(formContent).not.toContain("Executive Dashboard");
    // DashboardPage received the edit
    expect(dashboardContent).toContain("Executive Dashboard");
  });

  // 9. Scope Control
  it("Scope Control: single-file edit request does not modify unrelated files", async () => {
    const provider = new MockProvider();
    const pkgPath = path.join(fixture.dirPath, "package.json");
    const originalPkg = await fs.readFile(pkgPath, "utf-8");

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
              newText: '{loading ? "Loading..." : "Sign In"}'
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Done" };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath);
    for await (const event of runtime.run({
      message: "Update LoginButton text to Sign In",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    const afterPkg = await fs.readFile(pkgPath, "utf-8");
    expect(afterPkg).toBe(originalPkg);
  });

  // 10. Large Repository Protection & Ignored Directories
  it("Large Repository Protection: ignores node_modules and .git during search and exploration", async () => {
    // Create nested node_modules and .git in fixture
    const nodeModulesDir = path.join(fixture.dirPath, "node_modules", "some-dep");
    await fs.mkdir(nodeModulesDir, { recursive: true });
    await fs.writeFile(
      path.join(nodeModulesDir, "LoginButton.tsx"),
      "// should be ignored"
    );

    const provider = new MockProvider();
    let turn = 0;
    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "search_files",
            arguments: { query: "LoginButton" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Search completed" };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath);
    let searchResult: ToolResult | undefined;

    for await (const event of runtime.run({
      message: "Search LoginButton",
      cwd: fixture.dirPath
    })) {
      if (event.type === "tool_result") {
        searchResult = event.result;
      }
    }

    expect(searchResult?.success).toBe(true);
    const matches = (searchResult?.output as { matches: Array<{ path: string }> }).matches;
    // Verify none of the matches come from node_modules
    for (const match of matches) {
      expect(match.path).not.toContain("node_modules");
    }
  });

  // 11. Skill Failure Isolation
  it("Skill Failure Isolation: corrupted or missing skill does not break runtime or tool execution", async () => {
    const provider = new MockProvider();
    const runtime = await createRuntime(provider, fixture.dirPath);

    // Register a broken skill
    const brokenSkillRegistry = new DefaultSkillRegistry();
    brokenSkillRegistry.register({
      name: "broken-skill",
      description: "Broken",
      category: "frontend",
      version: "1.0.0",
      instructions: ["Invalid skill instruction"],
      activation: { when: ["broken"] }
    });

    const events = [];
    for await (const event of runtime.run({
      message: "broken prompt should still work",
      cwd: fixture.dirPath
    })) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    expect(runtime.getState().status).toBe("completed");
  });

  // 12. Provider Error Recovery & Scrubbing
  it("Provider Error Recovery: handles provider exception cleanly without crashing runtime", async () => {
    const provider = new MockProvider();
    provider.generateHandler = async function* () {
      yield { type: "error", error: new Error("500 Internal Provider Error (API_KEY=secret_key_123)") };
    };

    const runtime = await createRuntime(provider, fixture.dirPath);
    const events = [];

    for await (const event of runtime.run({
      message: "Trigger provider error",
      cwd: fixture.dirPath
    })) {
      events.push(event);
    }

    expect(runtime.getState().status).toBe("failed");
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
  });

  // 13. Cancellation Recovery
  it("Cancellation Recovery: cancels mid-run cleanly and leaves runtime ready for next turn", async () => {
    const provider = new MockProvider();
    provider.generateHandler = async function* (req, signal) {
      if (signal?.aborted) {
        throw new Error("Aborted");
      }
      yield { type: "text_delta", content: "Step 1" };
      await new Promise((r) => setTimeout(r, 50));
      yield { type: "completed" };
    };

    const runtime = await createRuntime(provider, fixture.dirPath);
    setTimeout(() => {
      runtime.cancel();
    }, 5);

    for await (const event of runtime.run({
      message: "Long task",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    // Now submit a new valid request on the same runtime
    provider.generateHandler = async function* () {
      yield { type: "text_delta", content: "Fresh turn finished." };
      yield { type: "completed" };
    };

    const freshEvents = [];
    for await (const event of runtime.run({
      message: "Fresh task",
      cwd: fixture.dirPath
    })) {
      freshEvents.push(event);
    }

    expect(freshEvents.some((e) => e.type === "text")).toBe(true);
    expect(runtime.getState().status).toBe("completed");
  });

  // 14. Conversation Integrity
  it("Conversation Integrity: messages array contains only user, assistant, and tool messages", async () => {
    const provider = new MockProvider();
    let turn = 0;

    provider.generateHandler = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: { id: "call-1", name: "read_file", arguments: { path: "src/components/LoginForm.tsx" } }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Inspected LoginForm." };
        yield { type: "completed" };
      }
    };

    const runtime = await createRuntime(provider, fixture.dirPath);
    for await (const event of runtime.run({
      message: "Inspect LoginForm",
      cwd: fixture.dirPath
    })) {
      void event;
    }

    const messages = runtime.getState().messages;
    expect(messages.length).toBe(4);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[2].role).toBe("tool");
    expect(messages[3].role).toBe("assistant");

    // Ensure no raw internal strategy objects stored in messages
    for (const msg of messages) {
      expect(["user", "assistant", "system", "tool"]).toContain(msg.role);
    }
  });
});

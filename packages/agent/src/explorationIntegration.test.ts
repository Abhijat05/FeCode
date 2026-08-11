import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ModelProvider, ModelRequest, ModelEvent, ToolResult } from "@fecode/models";
import { AgentRuntime } from "./runtime.js";
import { createDefaultToolRegistry } from "./tools/defaultRegistry.js";
import { createFrontendTestFixture, type TestFixture } from "./test/fixtureProject.js";
import type { AgentEvent } from "./index.js";

class ExplorationMockModelProvider implements ModelProvider {
  public id = "mock-exploration-provider";
  public capabilities = {
    streaming: true,
    toolCalling: true,
    vision: false,
    maxContextTokens: 4096
  };

  public generateFn?: (
    request: ModelRequest,
    signal?: AbortSignal
  ) => AsyncIterable<ModelEvent>;

  async *generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    if (this.generateFn) {
      yield* this.generateFn(request, signal);
      return;
    }
  }
}

describe("Multi-Step Repository Exploration Integration", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createFrontendTestFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("Scenario 1: Search -> Read -> Final Response", async () => {
    const provider = new ExplorationMockModelProvider();
    const registry = createDefaultToolRegistry();
    let turn = 0;

    provider.generateFn = async function* (request: ModelRequest) {
      turn++;
      if (turn === 1) {
        // Step 1: Model calls search_files
        yield {
          type: "tool_call",
          call: {
            id: "call-search-header",
            name: "search_files",
            arguments: { query: "DashboardHeader" }
          }
        };
        yield { type: "completed" };
      } else if (turn === 2) {
        // Verify tool result was sent to model
        const lastMsg = request.messages[request.messages.length - 1];
        expect(lastMsg.role).toBe("tool");
        expect(lastMsg.toolCallId).toBe("call-search-header");

        // Step 2: Model calls read_file
        yield {
          type: "tool_call",
          call: {
            id: "call-read-header",
            name: "read_file",
            arguments: { path: "src/components/DashboardHeader.tsx" }
          }
        };
        yield { type: "completed" };
      } else {
        // Step 3: Model emits final text response
        yield {
          type: "text_delta",
          content: "The DashboardHeader component is defined in src/components/DashboardHeader.tsx."
        };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, { registry });
    const events: AgentEvent[] = [];

    for await (const event of runtime.run({
      message: "Where is the DashboardHeader component?",
      cwd: fixture.dirPath
    })) {
      events.push(event);
    }

    const toolCalls = events.filter((e) => e.type === "tool_call");
    const toolResults = events.filter((e) => e.type === "tool_result");
    const textDelta = events.find((e) => e.type === "text");

    expect(toolCalls).toHaveLength(2);
    expect(toolResults).toHaveLength(2);
    expect(textDelta).toBeDefined();
    if (textDelta && textDelta.type === "text") {
      expect(textDelta.content).toContain("src/components/DashboardHeader.tsx");
    }

    // Verify state message history integrity
    const state = runtime.getState();
    expect(state.status).toBe("completed");
    expect(state.messages).toHaveLength(6);
    expect(state.messages[0].role).toBe("user");
    expect(state.messages[1].role).toBe("assistant");
    expect(state.messages[2].role).toBe("tool");
    expect(state.messages[3].role).toBe("assistant");
    expect(state.messages[4].role).toBe("tool");
    expect(state.messages[5].role).toBe("assistant");
  });

  it("Scenario 2: List -> Search -> Read -> Final Response", async () => {
    const provider = new ExplorationMockModelProvider();
    const registry = createDefaultToolRegistry();
    let turn = 0;

    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: { id: "call-list", name: "list_directory", arguments: { path: "src" } }
        };
        yield { type: "completed" };
      } else if (turn === 2) {
        yield {
          type: "tool_call",
          call: { id: "call-search", name: "search_files", arguments: { query: "DashboardPage", path: "src" } }
        };
        yield { type: "completed" };
      } else if (turn === 3) {
        yield {
          type: "tool_call",
          call: { id: "call-read", name: "read_file", arguments: { path: "src/pages/DashboardPage.tsx" } }
        };
        yield { type: "completed" };
      } else {
        yield {
          type: "text_delta",
          content: "DashboardPage renders the Dashboard component inside a div with className 'dashboard-page'."
        };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, { registry });
    const events: AgentEvent[] = [];

    for await (const event of runtime.run({
      message: "What does DashboardPage render?",
      cwd: fixture.dirPath
    })) {
      events.push(event);
    }

    const toolCalls = events.filter(
      (e): e is { type: "tool_call"; call: { id: string; name: string; arguments: unknown } } =>
        e.type === "tool_call"
    );
    expect(toolCalls).toHaveLength(3);
    expect(toolCalls[0].call.name).toBe("list_directory");
    expect(toolCalls[1].call.name).toBe("search_files");
    expect(toolCalls[2].call.name).toBe("read_file");

    const textEvent = events.find((e) => e.type === "text");
    expect(textEvent).toBeDefined();
  });

  it("Scenario 3: Tool Failure Recovery (model receives tool error and continues alternative approach)", async () => {
    const provider = new ExplorationMockModelProvider();
    const registry = createDefaultToolRegistry();
    let turn = 0;

    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        // Try reading non-existent file
        yield {
          type: "tool_call",
          call: { id: "call-fail", name: "read_file", arguments: { path: "src/nonexistent.tsx" } }
        };
        yield { type: "completed" };
      } else if (turn === 2) {
        // Recover by searching for component
        yield {
          type: "tool_call",
          call: { id: "call-recover", name: "search_files", arguments: { query: "Dashboard" } }
        };
        yield { type: "completed" };
      } else {
        yield {
          type: "text_delta",
          content: "src/nonexistent.tsx was not found, but Dashboard component is in src/components/Dashboard.tsx."
        };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, { registry });
    const events: AgentEvent[] = [];

    for await (const event of runtime.run({
      message: "Find Dashboard component",
      cwd: fixture.dirPath
    })) {
      events.push(event);
    }

    const failedResult = events.find(
      (e): e is { type: "tool_result"; result: ToolResult; callId: string } =>
        e.type === "tool_result" && e.callId === "call-fail"
    );

    expect(failedResult).toBeDefined();
    expect(failedResult?.result.success).toBe(false);
    expect(failedResult?.result.error?.code).toBe("NOT_FOUND");

    const finalResult = events.find((e) => e.type === "text");
    expect(finalResult).toBeDefined();
    expect(runtime.getState().status).toBe("completed");
  });
});

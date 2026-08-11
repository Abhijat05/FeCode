import { describe, it, expect } from "vitest";
import { DefaultToolRegistry } from "@fecode/models";
import type { ModelProvider, ModelRequest, ModelEvent, ToolResult } from "@fecode/models";
import { AgentRuntime } from "./runtime.js";
import { MockEchoTool } from "./tools/mockEchoTool.js";
import type { AgentEvent } from "./index.js";

class MockToolModelProvider implements ModelProvider {
  public id = "mock-tool-provider";
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

describe("AgentRuntime Tool Loop", () => {
  it("executes single tool call and returns result to model for final text response", async () => {
    const provider = new MockToolModelProvider();
    const registry = new DefaultToolRegistry();
    registry.register(new MockEchoTool());

    let turnCount = 0;
    const receivedRequests: ModelRequest[] = [];

    provider.generateFn = async function* (request: ModelRequest) {
      turnCount++;
      receivedRequests.push(request);

      if (turnCount === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "echo",
            arguments: { message: "hello" }
          }
        };
        yield { type: "completed" };
      } else {
        yield {
          type: "text_delta",
          content: "The tool returned hello."
        };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, { registry });
    const events: AgentEvent[] = [];

    for await (const event of runtime.run({ message: "Use echo hello", cwd: "/test" })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "tool_call",
        call: {
          id: "call-1",
          name: "echo",
          arguments: { message: "hello" }
        }
      },
      {
        type: "tool_result",
        result: {
          success: true,
          output: { message: "hello" }
        },
        callId: "call-1"
      },
      {
        type: "text",
        content: "The tool returned hello."
      },
      { type: "done" }
    ]);

    expect(receivedRequests).toHaveLength(2);
    // 2nd model request must contain tool result message
    expect(receivedRequests[1].messages).toEqual([
      { role: "user", content: "Use echo hello" },
      {
        role: "assistant",
        content: undefined,
        toolCalls: [{ id: "call-1", name: "echo", arguments: { message: "hello" } }]
      },
      {
        role: "tool",
        toolCallId: "call-1",
        name: "echo",
        content: JSON.stringify({ success: true, output: { message: "hello" } })
      }
    ]);
  });

  it("handles multiple sequential tool calls in separate turns", async () => {
    const provider = new MockToolModelProvider();
    const registry = new DefaultToolRegistry();
    registry.register(new MockEchoTool());

    let turnCount = 0;

    provider.generateFn = async function* () {
      turnCount++;
      if (turnCount === 1) {
        yield {
          type: "tool_call",
          call: { id: "call-1", name: "echo", arguments: { message: "first" } }
        };
        yield { type: "completed" };
      } else if (turnCount === 2) {
        yield {
          type: "tool_call",
          call: { id: "call-2", name: "echo", arguments: { message: "second" } }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Done all tools." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, { registry });
    const events: AgentEvent[] = [];

    for await (const event of runtime.run({ message: "Run two tools", cwd: "/test" })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "tool_call",
        call: { id: "call-1", name: "echo", arguments: { message: "first" } }
      },
      {
        type: "tool_result",
        result: { success: true, output: { message: "first" } },
        callId: "call-1"
      },
      {
        type: "tool_call",
        call: { id: "call-2", name: "echo", arguments: { message: "second" } }
      },
      {
        type: "tool_result",
        result: { success: true, output: { message: "second" } },
        callId: "call-2"
      },
      { type: "text", content: "Done all tools." },
      { type: "done" }
    ]);
  });

  it("returns error result to model when requested tool is not found", async () => {
    const provider = new MockToolModelProvider();
    const registry = new DefaultToolRegistry();
    let turnCount = 0;

    provider.generateFn = async function* () {
      turnCount++;
      if (turnCount === 1) {
        yield {
          type: "tool_call",
          call: { id: "call-bad", name: "unknown_tool", arguments: {} }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Apologies, tool not found." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, { registry });
    const events: AgentEvent[] = [];

    for await (const event of runtime.run({ message: "Run unknown", cwd: "/test" })) {
      events.push(event);
    }

    const toolResultEvent = events.find(
      (e): e is { type: "tool_result"; result: ToolResult; callId: string } =>
        e.type === "tool_result"
    );
    expect(toolResultEvent).toBeDefined();
    expect(toolResultEvent?.result.success).toBe(false);
    expect(toolResultEvent?.result.error?.message).toContain("Tool not found");
  });
});

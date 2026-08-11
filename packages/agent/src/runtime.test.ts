import { describe, it, expect } from "vitest";
import type { ModelProvider, ModelRequest, ModelEvent } from "@fecode/models";
import { AgentRuntime } from "./runtime.js";
import type { AgentEvent } from "./index.js";

class MockModelProvider implements ModelProvider {
  public id = "mock-provider";
  public capabilities = {
    streaming: true,
    toolCalling: false,
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

    yield { type: "text_delta", content: "Hello " };
    yield { type: "text_delta", content: "there!" };
    yield {
      type: "completed",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    };
  }
}

describe("AgentRuntime", () => {
  it("executes basic generation emitting text and done events", async () => {
    const provider = new MockModelProvider();
    const runtime = new AgentRuntime(provider);

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({ message: "Hi", cwd: "/test" })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text", content: "Hello " },
      { type: "text", content: "there!" },
      { type: "done" }
    ]);

    const state = runtime.getState();
    expect(state.status).toBe("completed");
    expect(state.messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello there!" }
    ]);
  });

  it("maintains conversation history across multiple sequential run() calls", async () => {
    const recordedRequests: ModelRequest[] = [];
    const provider = new MockModelProvider();

    provider.generateFn = async function* (request: ModelRequest) {
      recordedRequests.push(request);
      if (request.messages.length === 1) {
        yield { type: "text_delta", content: "I am FeCode." };
      } else {
        yield { type: "text_delta", content: "React is a UI library." };
      }
      yield { type: "completed" };
    };

    const runtime = new AgentRuntime(provider);

    // Turn 1
    const events1: AgentEvent[] = [];
    for await (const event of runtime.run({ message: "Who are you?", cwd: "/test" })) {
      events1.push(event);
    }

    // Turn 2
    const events2: AgentEvent[] = [];
    for await (const event of runtime.run({ message: "Explain React.", cwd: "/test" })) {
      events2.push(event);
    }

    expect(events1).toHaveLength(2);
    expect(events2).toHaveLength(2);

    expect(recordedRequests).toHaveLength(2);
    // Request 2 must contain conversation history
    expect(recordedRequests[1].messages).toEqual([
      { role: "user", content: "Who are you?" },
      { role: "assistant", content: "I am FeCode." },
      { role: "user", content: "Explain React." }
    ]);
  });

  it("handles provider errors cleanly without crashing", async () => {
    const provider = new MockModelProvider();
    provider.generateFn = async function* () {
      yield { type: "error", error: new Error("Model rate limit") };
    };

    const runtime = new AgentRuntime(provider);
    const events: AgentEvent[] = [];

    for await (const event of runtime.run({ message: "Test", cwd: "/test" })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "error", error: expect.any(Error) }
    ]);
    expect((events[0] as { type: "error"; error: Error }).error.message).toBe("Model rate limit");
    expect(runtime.getState().status).toBe("failed");
  });

  it("supports stream cancellation via cancel() and AbortSignal", async () => {
    const provider = new MockModelProvider();

    provider.generateFn = async function* (_request: ModelRequest, signal?: AbortSignal) {
      yield { type: "text_delta", content: "Starting..." };

      // Simulate long process checking signal
      if (signal?.aborted) {
        yield { type: "error", error: new Error("Request aborted") };
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      if (signal?.aborted) {
        yield { type: "error", error: new Error("Request aborted") };
        return;
      }

      yield { type: "text_delta", content: "Finished" };
      yield { type: "completed" };
    };

    const runtime = new AgentRuntime(provider);
    const events: AgentEvent[] = [];

    const runPromise = (async () => {
      for await (const event of runtime.run({ message: "Long task", cwd: "/test" })) {
        events.push(event);
      }
    })();

    // Cancel while running
    await new Promise((resolve) => setTimeout(resolve, 10));
    await runtime.cancel();
    await runPromise;

    expect(runtime.getState().status).toBe("cancelled");
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("preserves provided session ID or generates one when omitted", async () => {
    const provider = new MockModelProvider();

    // Preserves provided session ID
    const runtime1 = new AgentRuntime(provider, { sessionId: "custom-session-123" });
    expect(runtime1.getState().sessionId).toBe("custom-session-123");

    // Generates session ID when omitted
    const runtime2 = new AgentRuntime(provider);
    expect(runtime2.getState().sessionId).toBeDefined();
    expect(runtime2.getState().sessionId.length).toBeGreaterThan(0);
  });

  it("remains reusable for subsequent requests after completion or cancellation", async () => {
    const provider = new MockModelProvider();
    const runtime = new AgentRuntime(provider);

    // Request 1
    const events1: AgentEvent[] = [];
    for await (const event of runtime.run({ message: "First", cwd: "/test" })) {
      events1.push(event);
    }
    expect(events1.length).toBeGreaterThan(0);
    expect(runtime.getState().status).toBe("completed");

    // Request 2
    const events2: AgentEvent[] = [];
    for await (const event of runtime.run({ message: "Second", cwd: "/test" })) {
      events2.push(event);
    }
    expect(events2.length).toBeGreaterThan(0);
    expect(runtime.getState().status).toBe("completed");
    expect(runtime.getState().messages).toHaveLength(4);
  });
});

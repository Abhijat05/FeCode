import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicModelProvider } from "./index.js";
import type { ModelEvent } from "../../types.js";

describe("AnthropicModelProvider (offline unit tests)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws clear error when ANTHROPIC_API_KEY is missing", () => {
    expect(() => new AnthropicModelProvider()).toThrow(
      "ANTHROPIC_API_KEY is not configured."
    );
  });

  it("does not leak API key in error message", () => {
    try {
      new AnthropicModelProvider({ apiKey: "" });
    } catch (err: unknown) {
      expect((err as Error).message).not.toContain("sk-ant-");
      expect((err as Error).message).toBe("ANTHROPIC_API_KEY is not configured.");
    }
  });

  it("streams text_delta and completed events with mocked client", async () => {
    async function* mockStream() {
      yield {
        type: "message_start",
        message: { usage: { input_tokens: 12 } }
      };
      yield {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text" }
      };
      yield {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello " }
      };
      yield {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "world!" }
      };
      yield { type: "content_block_stop", index: 0 };
      yield {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 8 }
      };
      yield { type: "message_stop" };
    }

    const streamFn = vi.fn().mockReturnValue(mockStream());
    const mockClient = {
      messages: { stream: streamFn }
    } as unknown as Anthropic;

    const provider = new AnthropicModelProvider({
      apiKey: "sk-ant-fake-key",
      model: "claude-sonnet-5-5-test",
      client: mockClient
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({
      system: "System prompt",
      messages: [{ role: "user", content: "Test message" }]
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", content: "Hello " },
      { type: "text_delta", content: "world!" },
      {
        type: "completed",
        usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 }
      }
    ]);

    expect(streamFn).toHaveBeenCalledWith(
      {
        model: "claude-sonnet-5-5-test",
        max_tokens: 8192,
        system: "System prompt",
        messages: [{ role: "user", content: "Test message" }],
        tools: undefined
      },
      expect.objectContaining({
        signal: expect.any(Object),
        timeout: 60000
      })
    );
  });

  it("merges request.system and a role:system message into one system param, never in messages", async () => {
    async function* mockStream() {
      yield { type: "message_start", message: { usage: { input_tokens: 1 } } };
      yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } };
      yield { type: "message_stop" };
    }

    const streamFn = vi.fn().mockReturnValue(mockStream());
    const mockClient = { messages: { stream: streamFn } } as unknown as Anthropic;

    const provider = new AnthropicModelProvider({ apiKey: "sk-ant-fake-key", client: mockClient });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({
      system: "Base instructions",
      messages: [
        { role: "system", content: "Extra operator note" },
        { role: "user", content: "Hi" }
      ]
    })) {
      events.push(event);
    }

    const [params] = streamFn.mock.calls[0];
    expect(params.system).toBe("Base instructions\n\nExtra operator note");
    expect(params.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("groups consecutive tool-role messages into one user message's content array", async () => {
    async function* mockStream() {
      yield { type: "message_start", message: { usage: { input_tokens: 1 } } };
      yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } };
      yield { type: "message_stop" };
    }

    const streamFn = vi.fn().mockReturnValue(mockStream());
    const mockClient = { messages: { stream: streamFn } } as unknown as Anthropic;

    const provider = new AnthropicModelProvider({ apiKey: "sk-ant-fake-key", client: mockClient });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({
      messages: [
        { role: "user", content: "Run two tools" },
        {
          role: "assistant",
          toolCalls: [
            { id: "call_1", name: "tool_a", arguments: {} },
            { id: "call_2", name: "tool_b", arguments: {} }
          ]
        },
        { role: "tool", toolCallId: "call_1", content: "result a" },
        { role: "tool", toolCallId: "call_2", content: "result b" }
      ]
    })) {
      events.push(event);
    }

    const [params] = streamFn.mock.calls[0];
    expect(params.messages[0]).toEqual({ role: "user", content: "Run two tools" });
    expect(params.messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "tool_use", id: "call_1", name: "tool_a", input: {} },
        { type: "tool_use", id: "call_2", name: "tool_b", input: {} }
      ]
    });
    expect(params.messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call_1", content: "result a" },
        { type: "tool_result", tool_use_id: "call_2", content: "result b" }
      ]
    });
    expect(params.messages).toHaveLength(3);
  });

  it("handles cancellation via AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();

    const streamFn = vi.fn();
    const mockClient = { messages: { stream: streamFn } } as unknown as Anthropic;

    const provider = new AnthropicModelProvider({
      apiKey: "sk-ant-fake-key",
      client: mockClient
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate(
      { messages: [{ role: "user", content: "Test" }] },
      controller.signal
    )) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "error",
      error: expect.any(Error)
    });
    expect((events[0] as { type: "error"; error: Error }).error.message).toContain(
      "aborted"
    );
    expect(streamFn).not.toHaveBeenCalled();
  });

  it("yields error event when provider fails, redacting the API key", async () => {
    const streamFn = vi.fn().mockImplementation(() => {
      throw new Error("Invalid request: key sk-ant-abcdefghijklmnopqrstuvwxyz was rejected");
    });
    const mockClient = { messages: { stream: streamFn } } as unknown as Anthropic;

    const provider = new AnthropicModelProvider({
      apiKey: "sk-ant-abcdefghijklmnopqrstuvwxyz",
      client: mockClient
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({
      messages: [{ role: "user", content: "Test" }]
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    const err = (events[0] as { error: Error }).error;
    expect(err.message).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz");
    expect(err.message).toContain("[REDACTED_API_KEY]");
  });

  it("parses streaming tool call input_json_delta fragments into ModelEvent tool_call", async () => {
    async function* mockToolStream() {
      yield { type: "message_start", message: { usage: { input_tokens: 10 } } };
      yield {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "call_abc123", name: "echo" }
      };
      yield {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"mess' }
      };
      yield {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: 'age":"hi"}' }
      };
      yield { type: "content_block_stop", index: 0 };
      yield { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } };
      yield { type: "message_stop" };
    }

    const streamFn = vi.fn().mockReturnValue(mockToolStream());
    const mockClient = { messages: { stream: streamFn } } as unknown as Anthropic;

    const provider = new AnthropicModelProvider({
      apiKey: "sk-ant-fake-key",
      client: mockClient
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({
      messages: [{ role: "user", content: "Run echo tool" }],
      tools: [{ name: "echo", description: "Echo tool", inputSchema: { type: "object", properties: {} } }]
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "tool_call",
        call: {
          id: "call_abc123",
          name: "echo",
          arguments: { message: "hi" }
        }
      },
      {
        type: "completed",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
      }
    ]);

    const [params] = streamFn.mock.calls[0];
    expect(params.tools).toEqual([
      { name: "echo", description: "Echo tool", input_schema: { type: "object", properties: {} } }
    ]);
  });

  it("falls back to raw string arguments when tool call JSON is malformed", async () => {
    async function* mockToolStream() {
      yield { type: "message_start", message: { usage: { input_tokens: 1 } } };
      yield {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "call_1", name: "echo" }
      };
      yield {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "{not valid json" }
      };
      yield { type: "content_block_stop", index: 0 };
      yield { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } };
      yield { type: "message_stop" };
    }

    const streamFn = vi.fn().mockReturnValue(mockToolStream());
    const mockClient = { messages: { stream: streamFn } } as unknown as Anthropic;

    const provider = new AnthropicModelProvider({ apiKey: "sk-ant-fake-key", client: mockClient });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({
      messages: [{ role: "user", content: "Run echo tool" }]
    })) {
      events.push(event);
    }

    expect(events[0]).toEqual({
      type: "tool_call",
      call: { id: "call_1", name: "echo", arguments: "{not valid json" }
    });
  });

  it("uses maxTokens 8192 by default and respects an explicit override", async () => {
    async function* mockStream() {
      yield { type: "message_start", message: { usage: { input_tokens: 1 } } };
      yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } };
      yield { type: "message_stop" };
    }

    const streamFn = vi.fn().mockReturnValue(mockStream());
    const mockClient = { messages: { stream: streamFn } } as unknown as Anthropic;

    const provider = new AnthropicModelProvider({
      apiKey: "sk-ant-fake-key",
      client: mockClient,
      maxTokens: 2048
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({ messages: [{ role: "user", content: "Hi" }] })) {
      events.push(event);
    }

    expect(streamFn.mock.calls[0][0].max_tokens).toBe(2048);
  });

  it("times out cleanly when the stream hangs beyond timeoutMs", async () => {
    const streamFn = vi.fn().mockImplementation((_body: unknown, options?: { signal?: AbortSignal }) => {
      const iterator = {
        async next() {
          return new Promise((_, reject) => {
            if (options?.signal) {
              options.signal.addEventListener("abort", () => {
                reject(new Error("Request aborted due to timeout"));
              });
            }
          });
        }
      };
      return { [Symbol.asyncIterator]: () => iterator };
    });
    const mockClient = { messages: { stream: streamFn } } as unknown as Anthropic;

    const provider = new AnthropicModelProvider({
      apiKey: "sk-ant-fake-key",
      client: mockClient,
      timeoutMs: 50
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({
      messages: [{ role: "user", content: "Hello" }]
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    const err = (events[0] as { error: Error }).error;
    expect(err.message.toLowerCase()).toContain("timed out");
  });

  it("times out cleanly when the stream stalls mid-stream beyond streamIdleTimeoutMs", async () => {
    const streamFn = vi.fn().mockImplementation((_body: unknown, options?: { signal?: AbortSignal }) => {
      let sentFirst = false;
      const iterator = {
        async next() {
          if (!sentFirst) {
            sentFirst = true;
            return {
              done: false,
              value: {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: "Initial chunk" }
              }
            };
          }
          return new Promise((_, reject) => {
            if (options?.signal) {
              options.signal.addEventListener("abort", () => {
                reject(new Error("Stream aborted due to idle timeout"));
              });
            }
          });
        }
      };
      return { [Symbol.asyncIterator]: () => iterator };
    });
    const mockClient = { messages: { stream: streamFn } } as unknown as Anthropic;

    const provider = new AnthropicModelProvider({
      apiKey: "sk-ant-fake-key",
      client: mockClient,
      streamIdleTimeoutMs: 50
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({
      messages: [{ role: "user", content: "Hello" }]
    })) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toEqual({ type: "text_delta", content: "Initial chunk" });
    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe("error");
    const err = (lastEvent as { error: Error }).error;
    expect(err.message.toLowerCase()).toMatch(/stalled|timed out/);
  });
});

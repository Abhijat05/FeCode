import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type OpenAI from "openai";
import { OpenAIModelProvider } from "./index.js";
import type { ModelEvent } from "../../types.js";

describe("OpenAIModelProvider (offline unit tests)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws clear error when OPENAI_API_KEY is missing", () => {
    expect(() => new OpenAIModelProvider()).toThrow(
      "OPENAI_API_KEY is not configured."
    );
  });

  it("does not leak API key in error message", () => {
    try {
      new OpenAIModelProvider({ apiKey: "" });
    } catch (err: unknown) {
      expect((err as Error).message).not.toContain("sk-");
      expect((err as Error).message).toBe("OPENAI_API_KEY is not configured.");
    }
  });

  it("streams text_delta and completed events with mocked client", async () => {
    async function* mockStream() {
      yield {
        choices: [{ delta: { content: "Hello " } }]
      };
      yield {
        choices: [{ delta: { content: "world!" } }]
      };
      yield {
        choices: [],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20
        }
      };
    }

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockStream())
        }
      }
    } as unknown as OpenAI;

    const provider = new OpenAIModelProvider({
      apiKey: "sk-fake-key",
      model: "gpt-4o-test",
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

    expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
      {
        model: "gpt-4o-test",
        messages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "Test message" }
        ],
        stream: true,
        stream_options: { include_usage: true }
      },
      { signal: undefined }
    );
  });

  it("handles cancellation via AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn()
        }
      }
    } as unknown as OpenAI;

    const provider = new OpenAIModelProvider({
      apiKey: "sk-fake-key",
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
  });

  it("yields error event when provider fails", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error("API rate limit exceeded"))
        }
      }
    } as unknown as OpenAI;

    const provider = new OpenAIModelProvider({
      apiKey: "sk-fake-key",
      client: mockClient
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({
      messages: [{ role: "user", content: "Test" }]
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "error",
        error: new Error("API rate limit exceeded")
      }
    ]);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type OpenAI from "openai";
import { OllamaModelProvider } from "./index.js";
import type { ModelEvent } from "../../types.js";

describe("OllamaModelProvider (offline unit tests)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("constructs without requiring OPENAI_API_KEY using default base URL", () => {
    const provider = new OllamaModelProvider();
    expect(provider.id).toBe("ollama");
    expect(provider.baseUrl).toBe("http://localhost:11434/v1");
    expect(provider.model).toBe("qwen2.5-coder");
  });

  it("supports custom OLLAMA_BASE_URL environment variable", () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
    const provider = new OllamaModelProvider();
    expect(provider.baseUrl).toBe("http://127.0.0.1:11434/v1");
  });

  it("streams text_delta and completed events via OpenAI-compatible mock client", async () => {
    async function* mockStream() {
      yield {
        choices: [{ delta: { content: "Local " } }]
      };
      yield {
        choices: [{ delta: { content: "Ollama model!" } }]
      };
      yield {
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      };
    }

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockStream())
        }
      }
    } as unknown as OpenAI;

    const provider = new OllamaModelProvider({
      model: "qwen2.5-coder",
      client: mockClient
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({
      messages: [{ role: "user", content: "Hi" }]
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", content: "Local " },
      { type: "text_delta", content: "Ollama model!" },
      {
        type: "completed",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
      }
    ]);
  });

  it("provides helpful error message when connection fails", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED"))
        }
      }
    } as unknown as OpenAI;

    const provider = new OllamaModelProvider({
      model: "qwen2.5-coder",
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
    if (events[0].type === "error") {
      expect(events[0].error.message).toContain("Ollama server or model unavailable");
      expect(events[0].error.message).toContain("ollama pull qwen2.5-coder");
    }
  });
});

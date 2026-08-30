import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { GeminiModelProvider } from "./index.js";
import type { ModelEvent } from "../../types.js";

describe("GeminiModelProvider (offline unit tests)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws clear error when GEMINI_API_KEY is missing", () => {
    expect(() => new GeminiModelProvider()).toThrow(
      "GEMINI_API_KEY is not configured."
    );
  });

  it("does not leak API key in error message", () => {
    try {
      new GeminiModelProvider({ apiKey: "" });
    } catch (err: unknown) {
      expect((err as Error).message).not.toContain("AIza");
      expect((err as Error).message).toBe("GEMINI_API_KEY is not configured.");
    }
  });

  it("streams text_delta and completed events with mocked client", async () => {
    async function* mockStream() {
      yield {
        text: "Hello ",
        usageMetadata: {
          promptTokenCount: 15,
          candidatesTokenCount: 10,
          totalTokenCount: 25
        }
      };
      yield {
        text: "Gemini!",
        usageMetadata: {
          promptTokenCount: 15,
          candidatesTokenCount: 10,
          totalTokenCount: 25
        }
      };
    }

    const mockClient = {
      models: {
        generateContentStream: vi.fn().mockResolvedValue(mockStream())
      }
    } as unknown as GoogleGenAI;

    const provider = new GeminiModelProvider({
      apiKey: "fake-gemini-key",
      model: "gemini-2.5-flash",
      client: mockClient
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({
      system: "System instruction",
      messages: [{ role: "user", content: "Hi" }]
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", content: "Hello " },
      { type: "text_delta", content: "Gemini!" },
      {
        type: "completed",
        usage: { inputTokens: 15, outputTokens: 10, totalTokens: 25 }
      }
    ]);
  });

  it("converts functionCalls from Gemini chunks into ModelEvent tool_call", async () => {
    async function* mockStream() {
      yield {
        functionCalls: [
          {
            name: "list_directory",
            args: { path: "src" }
          }
        ]
      };
    }

    const mockClient = {
      models: {
        generateContentStream: vi.fn().mockResolvedValue(mockStream())
      }
    } as unknown as GoogleGenAI;

    const provider = new GeminiModelProvider({
      apiKey: "fake-gemini-key",
      client: mockClient
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({
      messages: [{ role: "user", content: "List files in src" }],
      tools: [{ name: "list_directory", description: "List dir", inputSchema: {} }]
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("tool_call");
    if (events[0].type === "tool_call") {
      expect(events[0].call.name).toBe("list_directory");
      expect(events[0].call.arguments).toEqual({ path: "src" });
    }
    expect(events[1].type).toBe("completed");
  });

  it("handles cancellation via AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();

    const mockClient = {
      models: {
        generateContentStream: vi.fn()
      }
    } as unknown as GoogleGenAI;

    const provider = new GeminiModelProvider({
      apiKey: "fake-gemini-key",
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
    expect(events[0].type).toBe("error");
    if (events[0].type === "error") {
      expect(events[0].error.message).toContain("aborted");
    }
  });

  it("coalesces multiple consecutive tool responses into a single user turn", async () => {
    let capturedContents: unknown = null;
    const mockClient = {
      models: {
        generateContentStream: vi.fn().mockImplementation((req: { contents: unknown }) => {
          capturedContents = req.contents;
          return (async function* () {
            yield { text: "Done analyzing" };
          })();
        })
      }
    } as unknown as GoogleGenAI;

    const provider = new GeminiModelProvider({
      apiKey: "fake-gemini-key",
      client: mockClient
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({
      messages: [
        { role: "user", content: "Check codebase" },
        {
          role: "assistant",
          toolCalls: [
            { id: "call-1", name: "list_directory", arguments: {} },
            { id: "call-2", name: "search_files", arguments: { query: "App" } }
          ]
        },
        {
          role: "tool",
          toolCallId: "call-1",
          name: "list_directory",
          content: JSON.stringify({ success: true, output: { path: ".", entries: [] } })
        },
        {
          role: "tool",
          toolCallId: "call-2",
          name: "search_files",
          content: JSON.stringify({ success: true, output: { query: "App", matches: [] } })
        }
      ]
    })) {
      events.push(event);
    }

    expect(Array.isArray(capturedContents)).toBe(true);
    const contents = capturedContents as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    expect(contents).toHaveLength(3); // user (prompt), model (2 tool calls), user (2 tool responses coalesced)
    expect(contents[0].role).toBe("user");
    expect(contents[1].role).toBe("model");
    expect(contents[2].role).toBe("user");
    expect(contents[2].parts).toHaveLength(2);
    expect(contents[2].parts[0].functionResponse).toBeDefined();
    expect(contents[2].parts[1].functionResponse).toBeDefined();
  });
});

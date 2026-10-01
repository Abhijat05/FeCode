import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import OpenAI from "openai";
import { OpenAICompatibleModelProvider } from "./index.js";
import type { ModelRequest } from "../../types.js";

describe("OpenAICompatibleModelProvider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_COMPATIBLE_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.FE_MODEL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("constructor & validation", () => {
    it("successfully creates provider with valid options", () => {
      const provider = new OpenAICompatibleModelProvider({
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "nvapi-test-key-12345",
        model: "deepseek-ai/deepseek-v4.1-flash"
      });

      expect(provider.id).toBe("openai-compatible");
      expect(provider.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
      expect(provider.model).toBe("deepseek-ai/deepseek-v4.1-flash");
      expect(provider.capabilities.streaming).toBe(true);
      expect(provider.capabilities.toolCalling).toBe(true);
      expect(provider.capabilities.vision).toBe(true);
    });

    it("throws clear error when base URL is missing", () => {
      expect(
        () =>
          new OpenAICompatibleModelProvider({
            apiKey: "nvapi-test-key-12345",
            model: "deepseek-ai/deepseek-v4.1-flash"
          })
      ).toThrow("OpenAI-compatible provider requires a base URL. Please set OPENAI_BASE_URL.");
    });

    it("throws clear error when base URL is malformed", () => {
      expect(
        () =>
          new OpenAICompatibleModelProvider({
            baseUrl: "not-a-valid-url",
            apiKey: "nvapi-test-key-12345",
            model: "deepseek-ai/deepseek-v4.1-flash"
          })
      ).toThrow(/invalid base URL/i);

      expect(
        () =>
          new OpenAICompatibleModelProvider({
            baseUrl: "ftp://integrate.api.nvidia.com/v1",
            apiKey: "nvapi-test-key-12345",
            model: "deepseek-ai/deepseek-v4.1-flash"
          })
      ).toThrow(/must be an HTTP or HTTPS URL/i);
    });

    it("throws clear error when API key is missing", () => {
      expect(
        () =>
          new OpenAICompatibleModelProvider({
            baseUrl: "https://integrate.api.nvidia.com/v1",
            model: "deepseek-ai/deepseek-v4.1-flash"
          })
      ).toThrow("OpenAI-compatible provider requires an API key. Please set OPENAI_API_KEY.");
    });

    it("throws clear error when model identifier is missing", () => {
      expect(
        () =>
          new OpenAICompatibleModelProvider({
            baseUrl: "https://integrate.api.nvidia.com/v1",
            apiKey: "nvapi-test-key-12345",
            model: ""
          })
      ).toThrow("OpenAI-compatible provider requires a model identifier. Please set FE_MODEL.");
    });

    it("falls back to environment variables when options are omitted", () => {
      process.env.OPENAI_BASE_URL = "https://integrate.api.nvidia.com/v1";
      process.env.OPENAI_API_KEY = "nvapi-env-key";
      process.env.FE_MODEL = "deepseek-ai/deepseek-v4.1-flash";

      const provider = new OpenAICompatibleModelProvider();
      expect(provider.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
      expect(provider.model).toBe("deepseek-ai/deepseek-v4.1-flash");
    });
  });

  describe("streaming & model generation", () => {
    it("streams text chunks and completed event with token usage", async () => {
      async function* mockStream() {
        yield { choices: [{ delta: { content: "Hello " } }] };
        yield { choices: [{ delta: { content: "from " } }] };
        yield { choices: [{ delta: { content: "DeepSeek!" } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
      }

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockStream())
          }
        }
      } as unknown as OpenAI;

      const provider = new OpenAICompatibleModelProvider({
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "test-key",
        model: "deepseek-ai/deepseek-v4.1-flash",
        client: mockClient
      });

      const request: ModelRequest = {
        messages: [{ role: "user", content: "Hi" }]
      };

      const events = [];
      for await (const event of provider.generate(request)) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "text_delta", content: "Hello " },
        { type: "text_delta", content: "from " },
        { type: "text_delta", content: "DeepSeek!" },
        {
          type: "completed",
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15
          }
        }
      ]);
    });

    it("handles reasoning_content (DeepSeek R1/V3 style) by wrapping in <think> tags", async () => {
      async function* mockStream() {
        yield { choices: [{ delta: { reasoning_content: "Thinking step 1..." } }] };
        yield { choices: [{ delta: { reasoning_content: " Thinking step 2." } }] };
        yield { choices: [{ delta: { content: "Final answer." } }] };
      }

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockStream())
          }
        }
      } as unknown as OpenAI;

      const provider = new OpenAICompatibleModelProvider({
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "test-key",
        model: "deepseek-ai/deepseek-v4.1-flash",
        client: mockClient
      });

      const events = [];
      for await (const event of provider.generate({ messages: [{ role: "user", content: "Solve this" }] })) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "text_delta", content: "<think>" },
        { type: "text_delta", content: "Thinking step 1..." },
        { type: "text_delta", content: " Thinking step 2." },
        { type: "text_delta", content: "</think>" },
        { type: "text_delta", content: "Final answer." },
        { type: "completed", usage: undefined }
      ]);
    });

    it("accumulates fragmented tool call arguments and yields tool_call event after stream", async () => {
      async function* mockStream() {
        yield {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_abc123",
                    type: "function",
                    function: { name: "readFile", arguments: '{"path":' }
                  }
                ]
              }
            }
          ]
        };
        yield {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: '"src/index.ts"}' }
                  }
                ]
              }
            }
          ]
        };
      }

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockStream())
          }
        }
      } as unknown as OpenAI;

      const provider = new OpenAICompatibleModelProvider({
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "test-key",
        model: "deepseek-ai/deepseek-v4.1-flash",
        client: mockClient
      });

      const events = [];
      for await (const event of provider.generate({ messages: [{ role: "user", content: "Read index.ts" }] })) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        type: "tool_call",
        call: {
          id: "call_abc123",
          name: "readFile",
          arguments: { path: "src/index.ts" }
        }
      });
      expect(events[1]).toEqual({
        type: "completed",
        usage: undefined
      });
    });

    it("does not dispatch incomplete tool calls if stream fails mid-stream", async () => {
      async function* mockStream() {
        yield {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_fail",
                    function: { name: "executeCommand", arguments: '{"cmd":"rm -rf' }
                  }
                ]
              }
            }
          ]
        };
        throw new Error("Connection reset mid-stream");
      }

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockStream())
          }
        }
      } as unknown as OpenAI;

      const provider = new OpenAICompatibleModelProvider({
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "test-key",
        model: "deepseek-ai/deepseek-v4.1-flash",
        client: mockClient
      });

      const events = [];
      for await (const event of provider.generate({ messages: [{ role: "user", content: "Do it" }] })) {
        events.push(event);
      }

      // Must NOT contain tool_call event
      expect(events.some((e) => e.type === "tool_call")).toBe(false);
      expect(events[0].type).toBe("error");
    });
  });

  describe("cancellation", () => {
    it("stops before calling client if already aborted", async () => {
      const createMock = vi.fn();
      const mockClient = {
        chat: {
          completions: {
            create: createMock
          }
        }
      } as unknown as OpenAI;

      const provider = new OpenAICompatibleModelProvider({
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "test-key",
        model: "deepseek-ai/deepseek-v4.1-flash",
        client: mockClient
      });

      const controller = new AbortController();
      controller.abort();

      const events = [];
      for await (const event of provider.generate({ messages: [{ role: "user", content: "Hi" }] }, controller.signal)) {
        events.push(event);
      }

      expect(createMock).not.toHaveBeenCalled();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      expect((events[0] as { error: Error }).error.message).toMatch(/aborted/i);
    });
  });

  describe("error handling and credential sanitization", () => {
    it("formats 401 unauthorized with endpoint and does not leak API key", async () => {
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error("401 Unauthorized - invalid api key: nvapi-secret-12345678"))
          }
        }
      } as unknown as OpenAI;

      const provider = new OpenAICompatibleModelProvider({
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "nvapi-secret-12345678",
        model: "deepseek-ai/deepseek-v4.1-flash",
        client: mockClient
      });

      const events = [];
      for await (const event of provider.generate({ messages: [{ role: "user", content: "Hi" }] })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      const err = (events[0] as { error: Error }).error;
      expect(err.message).toContain("401");
      expect(err.message).toContain("https://integrate.api.nvidia.com/v1");
      expect(err.message).not.toContain("nvapi-secret-12345678");
    });

    it("formats 404 model not found clearly", async () => {
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error("404 The model deepseek-ai/nonexistent does not exist"))
          }
        }
      } as unknown as OpenAI;

      const provider = new OpenAICompatibleModelProvider({
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "test-key",
        model: "deepseek-ai/nonexistent",
        client: mockClient
      });

      const events = [];
      for await (const event of provider.generate({ messages: [{ role: "user", content: "Hi" }] })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      const err = (events[0] as { error: Error }).error;
      expect(err.message).toContain("404");
      expect(err.message).toContain("deepseek-ai/nonexistent");
      expect(err.message).toContain("rejected by the configured endpoint");
    });

    it("formats 429 quota/rate limit error clearly", async () => {
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error("429 Too Many Requests - quota exceeded"))
          }
        }
      } as unknown as OpenAI;

      const provider = new OpenAICompatibleModelProvider({
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "test-key",
        model: "deepseek-ai/deepseek-v4.1-flash",
        client: mockClient
      });

      const events = [];
      for await (const event of provider.generate({ messages: [{ role: "user", content: "Hi" }] })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      const err = (events[0] as { error: Error }).error;
      expect(err.message).toContain("429");
      expect(err.message).toContain("quota exceeded or rate limit reached");
    });
  });
});

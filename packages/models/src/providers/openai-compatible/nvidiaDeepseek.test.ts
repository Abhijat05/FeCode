import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import OpenAI from "openai";
import { createModelProvider, createConfiguredFallbackChain } from "../../factory.js";
import { OpenAICompatibleModelProvider } from "./index.js";
import { classifyProviderError } from "../../errors/classification.js";
import type { ModelRequest } from "../../types.js";

describe("NVIDIA OpenAI-Compatible DeepSeek Integration", () => {
  const originalEnv = process.env;
  const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
  const DEEPSEEK_MODEL = "deepseek-ai/deepseek-v4.1-flash";
  const MOCK_NVIDIA_KEY = "nvapi-test-secret-key-abcdef123456";

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.FE_PROVIDER = "openai-compatible";
    process.env.FE_MODEL = DEEPSEEK_MODEL;
    process.env.OPENAI_API_KEY = MOCK_NVIDIA_KEY;
    process.env.OPENAI_BASE_URL = NVIDIA_BASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("successfully configures generic provider without rejecting model ID", () => {
    const provider = createModelProvider({
      provider: "openai-compatible",
      model: DEEPSEEK_MODEL,
      apiKey: MOCK_NVIDIA_KEY,
      baseUrl: NVIDIA_BASE_URL
    });

    expect(provider.id).toBe("openai-compatible");
    const compatProvider = provider as OpenAICompatibleModelProvider;
    expect(compatProvider.model).toBe(DEEPSEEK_MODEL);
    expect(compatProvider.baseUrl).toBe(NVIDIA_BASE_URL);
  });

  it("streams DeepSeek reasoning content and final text from NVIDIA endpoint", async () => {
    async function* mockNvidiaStream() {
      yield { choices: [{ delta: { reasoning_content: "Analyzing repository structure..." } }] };
      yield { choices: [{ delta: { reasoning_content: " Found 4 packages." } }] };
      yield { choices: [{ delta: { content: "Here is the summary of the packages." } }] };
      yield {
        choices: [{ delta: {} }],
        usage: { prompt_tokens: 45, completion_tokens: 28, total_tokens: 73 }
      };
    }

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockNvidiaStream())
        }
      }
    } as unknown as OpenAI;

    const provider = new OpenAICompatibleModelProvider({
      baseUrl: NVIDIA_BASE_URL,
      apiKey: MOCK_NVIDIA_KEY,
      model: DEEPSEEK_MODEL,
      client: mockClient
    });

    const request: ModelRequest = {
      system: "You are FeCode coding assistant.",
      messages: [{ role: "user", content: "Analyze workspace" }]
    };

    const events = [];
    for await (const event of provider.generate(request)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", content: "<think>" },
      { type: "text_delta", content: "Analyzing repository structure..." },
      { type: "text_delta", content: " Found 4 packages." },
      { type: "text_delta", content: "</think>" },
      { type: "text_delta", content: "Here is the summary of the packages." },
      {
        type: "completed",
        usage: {
          inputTokens: 45,
          outputTokens: 28,
          totalTokens: 73
        }
      }
    ]);
  });

  it("handles DeepSeek tool call generation with fragmented arguments", async () => {
    async function* mockToolStream() {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_deepseek_987",
                  type: "function",
                  function: { name: "readFile", arguments: '{"filePath":' }
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
                  function: { arguments: ' "packages/shared/src/config.ts"}' }
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
          create: vi.fn().mockResolvedValue(mockToolStream())
        }
      }
    } as unknown as OpenAI;

    const provider = new OpenAICompatibleModelProvider({
      baseUrl: NVIDIA_BASE_URL,
      apiKey: MOCK_NVIDIA_KEY,
      model: DEEPSEEK_MODEL,
      client: mockClient
    });

    const request: ModelRequest = {
      messages: [{ role: "user", content: "Read config.ts" }],
      tools: [
        {
          name: "readFile",
          description: "Read a file from disk",
          inputSchema: { type: "object", properties: { filePath: { type: "string" } } }
        }
      ]
    };

    const events = [];
    for await (const event of provider.generate(request)) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: "tool_call",
      call: {
        id: "call_deepseek_987",
        name: "readFile",
        arguments: { filePath: "packages/shared/src/config.ts" }
      }
    });
    expect(events[1]).toEqual({
      type: "completed",
      usage: undefined
    });
  });

  it("classifies NVIDIA 404 model rejection as unsupported_model and non-fallback", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(
            new Error(`404 Model '${DEEPSEEK_MODEL}' was rejected by the configured endpoint (${NVIDIA_BASE_URL})`)
          )
        }
      }
    } as unknown as OpenAI;

    const provider = new OpenAICompatibleModelProvider({
      baseUrl: NVIDIA_BASE_URL,
      apiKey: MOCK_NVIDIA_KEY,
      model: DEEPSEEK_MODEL,
      client: mockClient
    });

    const events = [];
    for await (const event of provider.generate({ messages: [{ role: "user", content: "Test" }] })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    const err = (events[0] as { error: Error }).error;
    const classification = classifyProviderError(err);

    expect(classification.category).toBe("unsupported_model");
    expect(classification.isFallbackEligible).toBe(false);
    expect(classification.isRetryable).toBe(false);
    expect(err.message).not.toContain(MOCK_NVIDIA_KEY);
  });

  it("classifies NVIDIA 429 quota exhaustion as fallback-eligible", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(
            new Error(`429 Too Many Requests - quota exceeded for endpoint ${NVIDIA_BASE_URL}`)
          )
        }
      }
    } as unknown as OpenAI;

    const provider = new OpenAICompatibleModelProvider({
      baseUrl: NVIDIA_BASE_URL,
      apiKey: MOCK_NVIDIA_KEY,
      model: DEEPSEEK_MODEL,
      client: mockClient
    });

    const events = [];
    for await (const event of provider.generate({ messages: [{ role: "user", content: "Test" }] })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    const err = (events[0] as { error: Error }).error;
    const classification = classifyProviderError(err);

    expect(classification.isFallbackEligible).toBe(true);
    expect(classification.category).toBe("quota_exhaustion");
    expect(err.message).not.toContain(MOCK_NVIDIA_KEY);
  });

  it("automatically falls back from NVIDIA DeepSeek to OpenAI on quota exhaustion", async () => {
    let nvidiaAttempts = 0;
    const mockNvidiaClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async () => {
            nvidiaAttempts++;
            throw new Error(`429 Too Many Requests: quota exceeded on ${NVIDIA_BASE_URL}`);
          })
        }
      }
    } as unknown as OpenAI;

    async function* mockOpenAiStream() {
      yield { choices: [{ delta: { content: "Fallback response from OpenAI" } }] };
    }

    const mockOpenAiClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockOpenAiStream())
        }
      }
    } as unknown as OpenAI;

    const primaryNvidia = new OpenAICompatibleModelProvider({
      baseUrl: NVIDIA_BASE_URL,
      apiKey: MOCK_NVIDIA_KEY,
      model: DEEPSEEK_MODEL,
      client: mockNvidiaClient
    });

    // Secondary provider
    const fallbackOpenAi = createModelProvider({
      provider: "openai",
      apiKey: "sk-openai-fallback-key"
    });
    // Replace internal client
    (fallbackOpenAi as unknown as { client: OpenAI }).client = mockOpenAiClient;

    const fallbackChain = createConfiguredFallbackChain({
      primaryProvider: "openai-compatible",
      primaryModel: DEEPSEEK_MODEL,
      openaiBaseUrl: NVIDIA_BASE_URL,
      openaiApiKey: MOCK_NVIDIA_KEY,
      fallbackProviders: ["openai"]
    });

    // Wire up candidates with our mocked providers
    const candidates = fallbackChain.getCandidates();
    (candidates[0] as { provider: unknown }).provider = primaryNvidia;
    (candidates[1] as { provider: unknown }).provider = fallbackOpenAi;

    const events = [];
    for await (const event of fallbackChain.generate({ messages: [{ role: "user", content: "Hello" }] })) {
      events.push(event);
    }

    expect(nvidiaAttempts).toBe(1);
    expect(events.some((e) => e.type === "fallback")).toBe(true);
    const fallbackEvent = events.find((e) => e.type === "fallback") as {
      type: "fallback";
      fromProvider: string;
      toProvider: string;
    };
    expect(fallbackEvent.fromProvider).toBe("openai-compatible");
    expect(fallbackEvent.toProvider).toBe("openai");

    expect(events.some((e) => e.type === "text_delta" && e.content === "Fallback response from OpenAI")).toBe(true);
    expect(fallbackChain.getActiveProviderId()).toBe("openai");
  });

  it("safely handles mid-stream cancellation with AbortSignal without triggering fallback", async () => {
    const controller = new AbortController();

    async function* mockHangingStream() {
      yield { choices: [{ delta: { content: "Starting..." } }] };
      controller.abort();
      yield { choices: [{ delta: { content: "Should not be received" } }] };
    }

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockHangingStream())
        }
      }
    } as unknown as OpenAI;

    const primaryNvidia = new OpenAICompatibleModelProvider({
      baseUrl: NVIDIA_BASE_URL,
      apiKey: MOCK_NVIDIA_KEY,
      model: DEEPSEEK_MODEL,
      client: mockClient
    });

    const fallbackChain = createConfiguredFallbackChain({
      primaryProvider: "openai-compatible",
      primaryModel: DEEPSEEK_MODEL,
      openaiBaseUrl: NVIDIA_BASE_URL,
      openaiApiKey: MOCK_NVIDIA_KEY,
      fallbackProviders: ["openai"]
    });

    const candidates = fallbackChain.getCandidates();
    (candidates[0] as { provider: unknown }).provider = primaryNvidia;

    const events = [];
    for await (const event of fallbackChain.generate(
      { messages: [{ role: "user", content: "Hello" }] },
      controller.signal
    )) {
      events.push(event);
    }

    // Must not trigger fallback
    expect(events.some((e) => e.type === "fallback")).toBe(false);
    expect(fallbackChain.getActiveProviderId()).toBe("openai-compatible");
    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe("error");
    expect((lastEvent as { error: Error }).error.message).toMatch(/aborted/i);
  });
});

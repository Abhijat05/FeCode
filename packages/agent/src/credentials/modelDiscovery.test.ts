import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  discoverAvailableModels,
  getCuratedDefaultModels,
  scrubSensitiveKey,
  type DiscoveredModel
} from "./modelDiscovery.js";

const mockGeminiList = vi.fn();
vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(function (this: any) {
      this.models = {
        list: mockGeminiList
      };
      return this;
    })
  };
});

const mockOpenAIList = vi.fn();
vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(function (this: any, config: any) {
      if (config?.baseURL?.includes("127.0.0.1:59999")) {
        this.models = {
          list: vi.fn().mockRejectedValue(new Error(`connect ECONNREFUSED 127.0.0.1:59999 (key: ${config?.apiKey})`))
        };
      } else {
        this.models = {
          list: mockOpenAIList
        };
      }
      return this;
    })
  };
});

const mockAnthropicList = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(function (this: any, config: any) {
      if (config?.baseURL?.includes("127.0.0.1:59999")) {
        this.models = {
          list: vi.fn().mockRejectedValue(new Error(`connect ECONNREFUSED 127.0.0.1:59999 (key: ${config?.apiKey})`))
        };
      } else {
        this.models = {
          list: mockAnthropicList
        };
      }
      return this;
    })
  };
});

describe("Model Discovery Engine (packages/agent/src/credentials/modelDiscovery)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Google Gemini (gemini)", () => {
    it("discovers, filters, strips models/ prefix, and pins recommendations", async () => {
      mockGeminiList.mockResolvedValue([
        {
          name: "models/gemini-1.5-flash",
          displayName: "Gemini 1.5 Flash",
          description: "Fast and versatile",
          supportedGenerationMethods: ["generateContent", "countTokens"]
        },
        {
          name: "models/text-embedding-004",
          displayName: "Text Embedding 004",
          supportedGenerationMethods: ["embedContent"]
        },
        {
          name: "models/imagen-3.0-generate-002",
          displayName: "Imagen 3",
          supportedGenerationMethods: ["generateContent"]
        },
        {
          name: "models/gemini-2.5-pro",
          displayName: "Gemini 2.5 Pro",
          supportedGenerationMethods: ["generateContent"]
        },
        {
          name: "models/gemini-2.5-flash",
          displayName: "Gemini 2.5 Flash",
          supportedGenerationMethods: ["generateContent"]
        },
        {
          name: "models/gemini-1.5-pro",
          displayName: "Gemini 1.5 Pro",
          supportedGenerationMethods: ["generateContent"]
        },
        {
          name: "models/custom-other-model",
          displayName: "Custom Other",
          supportedGenerationMethods: ["generateContent"]
        }
      ]);

      const result = await discoverAvailableModels({
        providerId: "gemini",
        apiKey: "AIzaFakeValidKey12345678901234567890"
      });

      expect(result.success).toBe(true);
      expect(result.models.length).toBe(5);

      // Verify prefix stripping
      expect(result.models.every((m) => !m.id.startsWith("models/"))).toBe(true);

      // Verify exclusions
      expect(result.models.some((m) => m.id.includes("embedding"))).toBe(false);
      expect(result.models.some((m) => m.id.includes("imagen"))).toBe(false);

      // Verify pinned recommendations order
      expect(result.models[0].id).toBe("gemini-2.5-flash");
      expect(result.models[0].isRecommended).toBe(true);
      expect(result.models[1].id).toBe("gemini-2.5-pro");
      expect(result.models[2].id).toBe("gemini-1.5-pro");
      expect(result.models[3].id).toBe("gemini-1.5-flash");
      expect(result.models[4].id).toBe("custom-other-model");
    });

    it("falls back to curated models with success=false when apiKey is missing", async () => {
      const result = await discoverAvailableModels({
        providerId: "gemini"
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("API key");
      expect(result.models.length).toBeGreaterThan(0);
      expect(result.models[0].id).toBe("gemini-2.5-flash");
      expect(result.models[0].isRecommended).toBe(true);
    });

    it("falls back to curated models and sanitizes error on API rejection", async () => {
      const rawKey = "AIzaSySecretApiKeyThatMustNotLeak12345";
      mockGeminiList.mockRejectedValue(new Error(`API call failed for key ${rawKey}: 403 Forbidden`));

      const result = await discoverAvailableModels({
        providerId: "gemini",
        apiKey: rawKey
      });

      expect(result.success).toBe(false);
      expect(result.error).not.toContain(rawKey);
      expect(result.error).toContain("[REDACTED_API_KEY]");
      expect(result.models[0].id).toBe("gemini-2.5-flash");
    });
  });

  describe("OpenAI (openai)", () => {
    it("filters out embeddings, audio, image, moderation, and legacy completions, including gpt-4*, o1*, o3*, chatgpt-*", async () => {
      mockOpenAIList.mockResolvedValue({
        data: [
          { id: "text-embedding-3-small" },
          { id: "whisper-1" },
          { id: "tts-1-hd" },
          { id: "dall-e-3" },
          { id: "text-moderation-latest" },
          { id: "davinci-002" },
          { id: "babbage-002" },
          { id: "gpt-3.5-turbo" }, // excluded per filter: only gpt-4*, o1*, o3*, chatgpt-*
          { id: "gpt-4o-mini" },
          { id: "o1-mini" },
          { id: "gpt-4o" },
          { id: "o3-mini" },
          { id: "o1" },
          { id: "chatgpt-4o-latest" },
          { id: "gpt-4-turbo" }
        ]
      });

      const result = await discoverAvailableModels({
        providerId: "openai",
        apiKey: "sk-proj-validTestKey12345678901234567890"
      });

      expect(result.success).toBe(true);
      expect(result.models.length).toBe(7);

      // Verify pinned recommendations order: gpt-4o (isRecommended: true), gpt-4o-mini, o3-mini, o1
      expect(result.models[0].id).toBe("gpt-4o");
      expect(result.models[0].isRecommended).toBe(true);
      expect(result.models[1].id).toBe("gpt-4o-mini");
      expect(result.models[2].id).toBe("o3-mini");
      expect(result.models[3].id).toBe("o1");

      // Verify unpinned included models follow
      const remainingIds = result.models.slice(4).map((m) => m.id);
      expect(remainingIds).toContain("o1-mini");
      expect(remainingIds).toContain("chatgpt-4o-latest");
      expect(remainingIds).toContain("gpt-4-turbo");

      // Verify exclusions
      expect(result.models.some((m) => m.id === "gpt-3.5-turbo")).toBe(false);
      expect(result.models.some((m) => m.id.includes("embedding"))).toBe(false);
      expect(result.models.some((m) => m.id.includes("whisper"))).toBe(false);
      expect(result.models.some((m) => m.id.includes("dall-e"))).toBe(false);
      expect(result.models.some((m) => m.id.includes("davinci"))).toBe(false);
    });

    it("falls back to curated models with success=false when apiKey is missing", async () => {
      const result = await discoverAvailableModels({
        providerId: "openai"
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("API key");
      expect(result.models[0].id).toBe("gpt-4o");
      expect(result.models[0].isRecommended).toBe(true);
    });

    it("handles connection rejection using loopback 127.0.0.1:59999 (<10ms) and scrubs key", async () => {
      const rawKey = "sk-super-secret-openai-key-99999999999";
      const result = await discoverAvailableModels({
        providerId: "openai",
        apiKey: rawKey,
        baseUrl: "http://127.0.0.1:59999/v1"
      });

      expect(result.success).toBe(false);
      expect(result.error).not.toContain(rawKey);
      expect(result.error).toContain("[REDACTED_API_KEY]");
      expect(result.models[0].id).toBe("gpt-4o");
    });
  });

  describe("Ollama (ollama)", () => {
    it("pins coder/code models to top and marks first coder model as recommended", async () => {
      mockOpenAIList.mockResolvedValue({
        data: [
          { id: "llama3:latest" },
          { id: "mistral:7b" },
          { id: "qwen2.5-coder:latest" },
          { id: "deepseek-coder:6.7b" }
        ]
      });

      const result = await discoverAvailableModels({
        providerId: "ollama"
      });

      expect(result.success).toBe(true);
      expect(result.models.length).toBe(4);

      // Coder models sorted to top
      expect(result.models[0].id).toBe("qwen2.5-coder:latest");
      expect(result.models[0].isRecommended).toBe(true);
      expect(result.models[1].id).toBe("deepseek-coder:6.7b");

      // Non-coder models after
      expect(result.models[2].id).toBe("llama3:latest");
      expect(result.models[3].id).toBe("mistral:7b");
    });

    it("falls back to qwen2.5-coder when Ollama daemon is offline (loopback rejection)", async () => {
      const result = await discoverAvailableModels({
        providerId: "ollama",
        baseUrl: "http://127.0.0.1:59999/v1"
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.models).toEqual([
        {
          id: "qwen2.5-coder",
          displayName: "Qwen 2.5 Coder",
          isRecommended: true
        }
      ]);
    });
  });

  describe("OpenAI-Compatible (openai-compatible)", () => {
    it("excludes *embedding* models and pins default deepseek model to top", async () => {
      mockOpenAIList.mockResolvedValue({
        data: [
          { id: "bge-large-en-v1.5-embedding" },
          { id: "meta/llama-3.1-70b-instruct" },
          { id: "deepseek-ai/deepseek-v4.1-flash" },
          { id: "text-embedding-ada-002" }
        ]
      });

      const result = await discoverAvailableModels({
        providerId: "openai-compatible",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "nvapi-fake-key"
      });

      expect(result.success).toBe(true);
      expect(result.models.length).toBe(2);

      // Excludes embeddings
      expect(result.models.some((m) => m.id.includes("embedding"))).toBe(false);

      // Pins default model to top
      expect(result.models[0].id).toBe("deepseek-ai/deepseek-v4.1-flash");
      expect(result.models[0].isRecommended).toBe(true);
      expect(result.models[1].id).toBe("meta/llama-3.1-70b-instruct");
    });

    it("requires baseUrl and falls back cleanly if baseUrl is missing", async () => {
      const result = await discoverAvailableModels({
        providerId: "openai-compatible"
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("base URL");
      expect(result.models[0].id).toBe("deepseek-ai/deepseek-v4.1-flash");
      expect(result.models[0].isRecommended).toBe(true);
    });

    it("handles connection failure cleanly via loopback rejection", async () => {
      const rawKey = "nvapi-test-secret-key-12345678";
      const result = await discoverAvailableModels({
        providerId: "openai-compatible",
        baseUrl: "http://127.0.0.1:59999/v1",
        apiKey: rawKey
      });

      expect(result.success).toBe(false);
      expect(result.error).not.toContain(rawKey);
      expect(result.models[0].id).toBe("deepseek-ai/deepseek-v4.1-flash");
    });
  });

  describe("Anthropic (anthropic)", () => {
    it("returns discovered models when client.models.list succeeds", async () => {
      mockAnthropicList.mockResolvedValue({
        data: [
          { id: "claude-3-opus-20240229", display_name: "Claude 3 Opus" },
          { id: "claude-3-5-sonnet-20241022", display_name: "Claude 3.5 Sonnet" },
          { id: "claude-3-5-haiku-20241022", display_name: "Claude 3.5 Haiku" }
        ]
      });

      const result = await discoverAvailableModels({
        providerId: "anthropic",
        apiKey: "sk-ant-validTestKey12345678901234567890"
      });

      expect(result.success).toBe(true);
      expect(result.models.length).toBe(3);
      // Pinned sonnet recommendation
      expect(result.models[0].id).toBe("claude-3-5-sonnet-20241022");
      expect(result.models[0].isRecommended).toBe(true);
    });

    it("falls back to curated Claude models when models.list is not supported/throws non-auth error", async () => {
      mockAnthropicList.mockRejectedValue(new Error("404 Endpoint not found: GET /v1/models is not supported"));

      const result = await discoverAvailableModels({
        providerId: "anthropic",
        apiKey: "sk-ant-validTestKey12345678901234567890"
      });

      // Endpoint not supported fallback retains success=true with curated models
      expect(result.success).toBe(true);
      expect(result.models.map((m) => m.id)).toEqual([
        "claude-3-5-sonnet-latest",
        "claude-3-5-haiku-latest",
        "claude-3-opus-latest"
      ]);
      expect(result.models[0].isRecommended).toBe(true);
    });

    it("falls back to curated Claude models with success=false when apiKey is missing", async () => {
      const result = await discoverAvailableModels({
        providerId: "anthropic"
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("API key");
      expect(result.models.map((m) => m.id)).toEqual([
        "claude-3-5-sonnet-latest",
        "claude-3-5-haiku-latest",
        "claude-3-opus-latest"
      ]);
    });

    it("sanitizes API keys on network failure", async () => {
      const rawKey = "sk-ant-super-secret-claude-key-123456789";
      const result = await discoverAvailableModels({
        providerId: "anthropic",
        apiKey: rawKey,
        baseUrl: "http://127.0.0.1:59999/v1"
      });

      expect(result.success).toBe(false);
      expect(result.error).not.toContain(rawKey);
      expect(result.error).toContain("[REDACTED_API_KEY]");
      expect(result.models.length).toBe(3);
    });
  });

  describe("Security, Timeouts, and Signal Handling", () => {
    it("never leaks raw API keys in error output (scrubSensitiveKey)", () => {
      const sensitive = "Error with key sk-proj-12345678901234567890 and sk-ant-abcdefghijklmnop12345678 and AIzaSy123456789012345678901234567890";
      const scrubbed = scrubSensitiveKey(sensitive);
      expect(scrubbed).not.toContain("sk-proj-");
      expect(scrubbed).not.toContain("sk-ant-");
      expect(scrubbed).not.toContain("AIzaSy");
      expect(scrubbed).toContain("[REDACTED_API_KEY]");
    });

    it("handles already-aborted signal gracefully without hanging", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await discoverAvailableModels({
        providerId: "gemini",
        apiKey: "AIzaTestKey12345",
        signal: controller.signal
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("cancelled");
      expect(result.models.length).toBeGreaterThan(0);
    });

    it("handles timeouts gracefully when requests hang", async () => {
      mockGeminiList.mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Request timed out")), 200);
        });
      });

      const result = await discoverAvailableModels({
        providerId: "gemini",
        apiKey: "AIzaTestKey12345",
        timeoutMs: 50
      });

      expect(result.success).toBe(false);
      expect(result.error?.toLowerCase()).toContain("time");
      expect(result.models.length).toBeGreaterThan(0);
    });

    it("gracefully handles unknown provider without throwing", async () => {
      const result = await discoverAvailableModels({
        providerId: "unknown-custom-llm"
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("unknown-custom-llm");
      expect(result.models).toEqual([]);
    });

    it("returns curated default models for each supported provider", () => {
      const providers = ["gemini", "openai", "ollama", "openai-compatible", "anthropic"];
      for (const provider of providers) {
        const defaults: DiscoveredModel[] = getCuratedDefaultModels(provider);
        expect(defaults.length).toBeGreaterThan(0);
        expect(defaults.some((m) => m.isRecommended)).toBe(true);
      }

      const unknown = getCuratedDefaultModels("non-existent-provider");
      expect(unknown).toEqual([]);
    });

    it("is re-exported by @fecode/agent root and credentials index", async () => {
      const rootExports = await import("../index.js");
      const credExports = await import("./index.js");

      expect(typeof rootExports.discoverAvailableModels).toBe("function");
      expect(typeof credExports.discoverAvailableModels).toBe("function");
      expect(typeof rootExports.getCuratedDefaultModels).toBe("function");
      expect(typeof credExports.getCuratedDefaultModels).toBe("function");
      expect(typeof rootExports.scrubSensitiveKey).toBe("function");
      expect(typeof credExports.scrubSensitiveKey).toBe("function");
    });
  });
});

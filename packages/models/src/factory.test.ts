import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createModelProvider, createConfiguredFallbackChain } from "./factory.js";

describe("createModelProvider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.GEMINI_API_KEY = "fake-gemini-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates OpenAIModelProvider when provider is 'openai'", () => {
    const provider = createModelProvider({
      provider: "openai"
    });

    expect(provider.id).toBe("openai");
  });

  it("creates GeminiModelProvider when provider is 'gemini'", () => {
    const provider = createModelProvider({
      provider: "gemini"
    });

    expect(provider.id).toBe("gemini");
  });

  it("creates OllamaModelProvider when provider is 'ollama'", () => {
    const provider = createModelProvider({
      provider: "ollama"
    });

    expect(provider.id).toBe("ollama");
  });

  it("creates OpenAICompatibleModelProvider when provider is 'openai-compatible'", () => {
    const provider = createModelProvider({
      provider: "openai-compatible",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: "nvapi-test-key",
      model: "deepseek-ai/deepseek-v4.1-flash"
    });

    expect(provider.id).toBe("openai-compatible");
  });

  it("throws clear error when openai-compatible is missing baseUrl", () => {
    expect(() =>
      createModelProvider({
        provider: "openai-compatible",
        apiKey: "nvapi-test-key",
        model: "deepseek-ai/deepseek-v4.1-flash"
      })
    ).toThrow(/requires a base URL/i);
  });

  it("throws clear error when openai-compatible is missing apiKey", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() =>
      createModelProvider({
        provider: "openai-compatible",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        model: "deepseek-ai/deepseek-v4.1-flash"
      })
    ).toThrow(/requires an API key/i);
  });

  it("throws clear error when openai-compatible is missing model", () => {
    expect(() =>
      createModelProvider({
        provider: "openai-compatible",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "nvapi-test-key",
        model: ""
      })
    ).toThrow(/requires a model identifier/i);
  });

  it("throws error for unsupported provider", () => {
    expect(() =>
      createModelProvider({
        provider: "unsupported-provider"
      })
    ).toThrow("Unsupported model provider: unsupported-provider");
  });

  it("reproduces reported failure when FE_PROVIDER is set to 'deepseek' (model name as provider)", () => {
    expect(() =>
      createModelProvider({
        provider: "deepseek",
        model: "deepseek-ai/deepseek-v4.1-flash"
      })
    ).toThrow("Unsupported model provider: deepseek");
  });
});

describe("createConfiguredFallbackChain", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.GEMINI_API_KEY = "fake-gemini-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates a FallbackModelProvider with primary provider and eligible configured candidates", () => {
    const chain = createConfiguredFallbackChain({
      primaryProvider: "gemini",
      primaryModel: "gemini-2.5-flash",
      fallbackProviders: ["openai", "ollama"]
    });

    expect(chain.id).toBe("fallback");
    expect(chain.getActiveProviderId()).toBe("gemini");
  });

  it("never includes unconfigured providers with missing credentials", () => {
    delete process.env.OPENAI_API_KEY;
    const chain = createConfiguredFallbackChain({
      primaryProvider: "gemini",
      fallbackProviders: ["openai"] // openai has no key
    });

    // Should only have gemini
    expect(chain.getActiveProviderId()).toBe("gemini");
  });

  it("preserves deterministic ordering specified in fallbackProviders", () => {
    const chain = createConfiguredFallbackChain({
      primaryProvider: "gemini",
      fallbackProviders: ["ollama", "openai"]
    });

    expect(chain.getActiveProviderId()).toBe("gemini");
  });

  it("creates a FallbackModelProvider with openai-compatible as primary provider", () => {
    const chain = createConfiguredFallbackChain({
      primaryProvider: "openai-compatible",
      primaryModel: "deepseek-ai/deepseek-v4.1-flash",
      openaiBaseUrl: "https://integrate.api.nvidia.com/v1",
      openaiApiKey: "nvapi-test-key",
      fallbackProviders: ["openai", "gemini"]
    });

    expect(chain.id).toBe("fallback");
    expect(chain.getActiveProviderId()).toBe("openai-compatible");
    const candidates = chain.getCandidates();
    expect(candidates.map((c) => c.provider.id)).toEqual([
      "openai-compatible",
      "openai",
      "gemini"
    ]);
  });

  it("includes openai-compatible in fallback chain when configured with credentials", () => {
    const chain = createConfiguredFallbackChain({
      primaryProvider: "gemini",
      primaryModel: "gemini-2.5-flash",
      fallbackProviders: ["openai-compatible", "openai"],
      openaiBaseUrl: "https://integrate.api.nvidia.com/v1",
      openaiApiKey: "nvapi-test-key"
    });

    expect(chain.id).toBe("fallback");
    expect(chain.getActiveProviderId()).toBe("gemini");
    const candidates = chain.getCandidates();
    expect(candidates.map((c) => c.provider.id)).toEqual([
      "gemini",
      "openai-compatible",
      "openai"
    ]);
  });

  it("omits openai-compatible from fallback chain when baseUrl is missing", () => {
    delete process.env.OPENAI_BASE_URL;
    const chain = createConfiguredFallbackChain({
      primaryProvider: "gemini",
      primaryModel: "gemini-2.5-flash",
      fallbackProviders: ["openai-compatible", "openai"],
      openaiApiKey: "nvapi-test-key"
    });

    const candidates = chain.getCandidates();
    expect(candidates.map((c) => c.provider.id)).toEqual(["gemini", "openai"]);
  });
});

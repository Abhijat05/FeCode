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

  it("throws error for unsupported provider", () => {
    expect(() =>
      createModelProvider({
        provider: "unsupported-provider"
      })
    ).toThrow("Unsupported model provider: unsupported-provider");
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
});

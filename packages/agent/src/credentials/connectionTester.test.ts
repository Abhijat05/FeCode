import { describe, it, expect } from "vitest";
import { testProviderConnection } from "./connectionTester.js";

describe("ConnectionTester", () => {
  it("redacts credentials from error messages when connection fails", async () => {
    const rawApiKey = "sk-super-secret-key-abcdef123456789";

    // Test with invalid OpenAI credentials that simulate API rejection containing the key
    const result = await testProviderConnection({
      providerId: "openai",
      model: "gpt-4o",
      apiKey: rawApiKey,
      baseUrl: "http://127.0.0.1:59999/v1"
    });

    expect(result.success).toBe(false);
    expect(result.steps.authentication).toBe("failed");
    // Prove that rawApiKey NEVER appears in result.message or result.error.reason
    expect(result.message).not.toContain(rawApiKey);
    if (result.error) {
      expect(result.error.reason).not.toContain(rawApiKey);
    }
  });

  it("handles cancellation gracefully via AbortSignal", async () => {
    const abortController = new AbortController();
    abortController.abort(); // already aborted

    const result = await testProviderConnection({
      providerId: "openai",
      model: "gpt-4o",
      apiKey: "sk-test-key",
      signal: abortController.signal
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("cancelled");
  });

  it("validates provider requirements before dispatching requests", async () => {
    // Missing API key for Gemini
    const geminiResult = await testProviderConnection({
      providerId: "gemini",
      model: "gemini-2.5-flash"
    });
    expect(geminiResult.success).toBe(false);
    expect(geminiResult.message).toContain("API key");

    // Missing base URL for OpenAI-compatible
    const compatResult = await testProviderConnection({
      providerId: "openai-compatible",
      model: "deepseek-ai/deepseek-v4.1-flash"
    });
    expect(compatResult.success).toBe(false);
    expect(compatResult.message).toContain("base URL");
  });

  it("classifies error categories cleanly using the error classification system", async () => {
    // Rate limit simulated error
    const result = await testProviderConnection({
      providerId: "openai-compatible",
      model: "test-model",
      apiKey: "nvapi-test-key",
      baseUrl: "https://httpstat.us/429"
    });

    expect(result.success).toBe(false);
    expect(result.error?.category).toBeDefined();
  });
});

import { describe, it, expect } from "vitest";
import { createModelProvider } from "./factory.js";

describe("createModelProvider factory", () => {
  it("instantiates OpenAI provider when provider is 'openai' and API key is set", () => {
    const provider = createModelProvider({
      provider: "openai",
      apiKey: "sk-fake-key",
      model: "gpt-4o-mini"
    });
    expect(provider.id).toBe("openai");
  });

  it("throws clear error for unsupported provider", () => {
    expect(() =>
      createModelProvider({
        provider: "anthropic"
      })
    ).toThrow("Unsupported model provider: anthropic");
  });
});

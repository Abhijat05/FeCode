import { describe, it, expect } from "vitest";
import type { ModelProvider } from "./index.js";

describe("@fecode/models", () => {
  it("instantiates ModelProvider interface correctly", () => {
    const provider: ModelProvider = { id: "anthropic" };
    expect(provider.id).toBe("anthropic");
  });
});

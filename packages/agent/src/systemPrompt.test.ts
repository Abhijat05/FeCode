import { describe, it, expect } from "vitest";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompt.js";

describe("DEFAULT_SYSTEM_PROMPT", () => {
  it("defines default FeCode system prompt establishing text-only mode", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("FeCode");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("without active tools");
  });
});

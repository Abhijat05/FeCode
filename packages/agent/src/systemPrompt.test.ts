import { describe, it, expect } from "vitest";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompt.js";

describe("DEFAULT_SYSTEM_PROMPT", () => {
  it("defines default FeCode system prompt establishing agent capabilities and tool usage", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("FeCode");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("workspace tools");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("list_directory");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("read_file");
  });
});

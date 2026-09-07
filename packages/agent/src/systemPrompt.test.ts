import { describe, it, expect } from "vitest";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompt.js";

describe("DEFAULT_SYSTEM_PROMPT", () => {
  it("identifies the agent as FeCode", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("FeCode");
  });

  it("lists all 6 workspace tools", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("list_directory");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("read_file");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("search_files");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("write_file");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("edit_file");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("execute_command");
  });

  it("explicitly forbids shell file commands", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("cat");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("grep");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("find");
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/Do NOT use.*ls/);
  });

  it("restricts execute_command to allowed dev tools", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("npm");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("npx");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("node");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("git");
  });

  it("forbids shell operators", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/no.*\|/);
    expect(DEFAULT_SYSTEM_PROMPT).toContain("&&");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("||");
  });

  it("includes workflow steps", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Understand");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Explore");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Verify");
  });

  it("enforces inspect-before-act and read-before-edit rules", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("ALWAYS explore before acting");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("READ before EDIT");
  });

  it("addresses security concerns", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Never leak secrets");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Stay in workspace");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Respect denials");
  });
});

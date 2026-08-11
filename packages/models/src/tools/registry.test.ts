import { describe, it, expect } from "vitest";
import { DefaultToolRegistry } from "./registry.js";
import type { Tool, ToolResult } from "./types.js";

class DummyTool implements Tool<{ text: string }, { echo: string }> {
  public name = "dummy";
  public description = "Dummy test tool";
  public inputSchema = {
    type: "object",
    properties: { text: { type: "string" } }
  };

  async execute(
    input: { text: string }
  ): Promise<ToolResult<{ echo: string }>> {
    return { success: true, output: { echo: input.text } };
  }
}

describe("DefaultToolRegistry", () => {
  it("registers, retrieves, and lists tools", () => {
    const registry = new DefaultToolRegistry();
    expect(registry.list()).toHaveLength(0);

    const tool = new DummyTool();
    registry.register(tool);

    expect(registry.get("dummy")).toBe(tool);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].name).toBe("dummy");
  });

  it("returns undefined for unregistered tool name", () => {
    const registry = new DefaultToolRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });
});

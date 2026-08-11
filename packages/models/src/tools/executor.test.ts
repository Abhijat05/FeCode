import { describe, it, expect } from "vitest";
import { DefaultToolRegistry } from "./registry.js";
import { DefaultToolExecutor } from "./executor.js";
import type { Tool, ToolResult } from "./types.js";

class EchoTool implements Tool<{ message: string }, { message: string }> {
  public name = "echo";
  public description = "Echo tool";
  public inputSchema = {
    type: "object",
    properties: { message: { type: "string" } }
  };

  async execute(
    input: { message: string }
  ): Promise<ToolResult<{ message: string }>> {
    return { success: true, output: { message: input.message } };
  }
}

describe("DefaultToolExecutor", () => {
  it("executes registered tool and returns output", async () => {
    const registry = new DefaultToolRegistry();
    registry.register(new EchoTool());

    const executor = new DefaultToolExecutor(registry);
    const controller = new AbortController();

    const result = await executor.execute(
      {
        id: "call-1",
        name: "echo",
        arguments: { message: "Hello world" }
      },
      { cwd: "/test", signal: controller.signal }
    );

    expect(result).toEqual({
      success: true,
      output: { message: "Hello world" }
    });
  });

  it("handles stringified JSON arguments", async () => {
    const registry = new DefaultToolRegistry();
    registry.register(new EchoTool());

    const executor = new DefaultToolExecutor(registry);
    const controller = new AbortController();

    const result = await executor.execute(
      {
        id: "call-2",
        name: "echo",
        arguments: JSON.stringify({ message: "Parsed JSON" })
      },
      { cwd: "/test", signal: controller.signal }
    );

    expect(result).toEqual({
      success: true,
      output: { message: "Parsed JSON" }
    });
  });

  it("returns clear error when tool does not exist", async () => {
    const registry = new DefaultToolRegistry();
    const executor = new DefaultToolExecutor(registry);
    const controller = new AbortController();

    const result = await executor.execute(
      {
        id: "call-3",
        name: "missing_tool",
        arguments: {}
      },
      { cwd: "/test", signal: controller.signal }
    );

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Tool not found: missing_tool");
  });
});

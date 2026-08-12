import { describe, it, expect } from "vitest";
import { MockWriteTool } from "./mockWriteTool.js";
import type { ToolContext } from "@fecode/models";

describe("MockWriteTool", () => {
  it("declares write permissionCategory and simulates writing content", async () => {
    const tool = new MockWriteTool();
    expect(tool.name).toBe("mock_write");
    expect(tool.permissionCategory).toBe("write");

    const context: ToolContext = {
      cwd: "/test",
      signal: new AbortController().signal
    };

    const res = await tool.execute({ path: "file.txt", content: "hello" }, context);
    expect(res.success).toBe(true);
    expect(res.output).toEqual({ path: "file.txt", bytesWritten: 5 });
  });
});

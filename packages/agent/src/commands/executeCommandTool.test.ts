import { describe, it, expect, beforeEach } from "vitest";
import { ExecuteCommandTool } from "./executeCommandTool.js";
import { MockCommandExecutor } from "./mockExecutor.js";
import type { ToolContext } from "@fecode/models";

describe("ExecuteCommandTool", () => {
  let tool: ExecuteCommandTool;
  let mockExecutor: MockCommandExecutor;
  let context: ToolContext;
  const controller = new AbortController();

  beforeEach(() => {
    mockExecutor = new MockCommandExecutor();
    tool = new ExecuteCommandTool(mockExecutor);
    context = { cwd: "/test/project", signal: controller.signal };
  });

  it("declares name = 'execute_command' and permissionCategory = 'execute'", () => {
    expect(tool.name).toBe("execute_command");
    expect(tool.permissionCategory).toBe("execute");
  });

  it("rejects missing or empty command argument with INVALID_ARGUMENT", async () => {
    const resNoCmd = await tool.execute({ command: "" }, context);
    expect(resNoCmd.success).toBe(false);
    expect(resNoCmd.error?.code).toBe("INVALID_ARGUMENT");

    const resNullCmd = await tool.execute({ command: null as unknown as string }, context);
    expect(resNullCmd.success).toBe(false);
    expect(resNullCmd.error?.code).toBe("INVALID_ARGUMENT");
  });

  it("passes command and ToolContext.cwd to CommandExecutor and returns structured result", async () => {
    mockExecutor.defaultResult = {
      exitCode: 0,
      stdout: "Type check passed.\n",
      stderr: "",
      timedOut: false,
      truncated: false
    };

    const res = await tool.execute({ command: "npm run typecheck" }, context);
    expect(res.success).toBe(true);
    expect(res.output?.command).toBe("npm run typecheck");
    expect(res.output?.exitCode).toBe(0);
    expect(res.output?.stdout).toBe("Type check passed.\n");

    expect(mockExecutor.executedCommands).toHaveLength(1);
    expect(mockExecutor.executedCommands[0].options.cwd).toBe("/test/project");
  });

  it("returns success=false with structured output when executor reports error or non-zero exit code", async () => {
    mockExecutor.defaultResult = {
      exitCode: 1,
      stdout: "",
      stderr: "1 error found",
      timedOut: false,
      truncated: false,
      error: "Command execution failed with exit code 1."
    };

    const res = await tool.execute({ command: "npm run typecheck" }, context);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("EXECUTION_FAILED");
    expect(res.output?.stderr).toBe("1 error found");
  });
});

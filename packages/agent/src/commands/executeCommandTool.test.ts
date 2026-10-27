import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, beforeEach } from "vitest";
import { ExecuteCommandTool } from "./executeCommandTool.js";
import { MockCommandExecutor } from "./mockExecutor.js";
import { getGlobalTaskManager } from "../tasks/taskManager.js";
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

  it("spawns a background task and returns task metadata when isDaemon is true", async () => {
    const res = await tool.execute(
      { command: "node -e \"setInterval(()=>{},1000)\"", isDaemon: true },
      { cwd: process.cwd(), signal: controller.signal }
    );
    expect(res.success).toBe(true);
    expect(res.output?.isDaemon).toBe(true);
    expect(res.output?.taskId).toMatch(/^task-\d+$/);
    expect(res.output?.pid).toBeTypeOf("number");
    expect(res.output?.stdout).toContain("Background task started");

    if (res.output?.taskId) {
      await getGlobalTaskManager().kill(res.output.taskId);
    }
  });

  it("automatically recovers from stale git index.lock by removing lock and retrying", async () => {
    const tmpGitDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-locktool-test-"));
    const dotGit = path.join(tmpGitDir, ".git");
    await fs.mkdir(dotGit);
    const lockFile = path.join(dotGit, "index.lock");
    await fs.writeFile(lockFile, "old lock");

    // Make lock older than 5000ms
    const oldTime = (Date.now() - 10000) / 1000;
    await fs.utimes(lockFile, oldTime, oldTime);

    // Set mock executor: first call fails with lock error, second call succeeds
    let callCount = 0;
    mockExecutor.execute = async (cmd, _opts) => {
      callCount++;
      if (callCount === 1) {
        return {
          command: cmd,
          exitCode: 128,
          stdout: "",
          stderr: "fatal: Unable to create '.git/index.lock': File exists.",
          timedOut: false,
          truncated: false
        };
      }
      return {
        command: cmd,
        exitCode: 0,
        stdout: "Commit successful.\n",
        stderr: "",
        timedOut: false,
        truncated: false
      };
    };

    const res = await tool.execute(
      { command: "git commit -m 'test'" },
      { cwd: tmpGitDir, signal: controller.signal }
    );

    expect(callCount).toBe(2);
    expect(res.success).toBe(true);
    expect(res.output?.stdout).toContain("Auto-recovery: Cleared stale git lock");
    expect(res.output?.stdout).toContain("Commit successful.");

    // Lock file should be removed
    const exists = await fs.stat(lockFile).then(() => true).catch(() => false);
    expect(exists).toBe(false);

    await fs.rm(tmpGitDir, { recursive: true, force: true });
  });

  it("detects masked command failure and returns success=false even if exitCode is 0", async () => {
    mockExecutor.defaultResult = {
      exitCode: 0,
      stdout: "FAIL packages/agent/src/index.test.ts\nTests: 2 failed, 10 passed",
      stderr: "",
      timedOut: false,
      truncated: false
    };

    const res = await tool.execute({ command: "npm test" }, context);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("MASKED_COMMAND_FAILURE");
    expect(res.error?.message).toContain("Command completed with exit code 0, but failure output was detected");
    expect(res.output?.maskedFailure).toBe(true);
  });

  it("permits masked failure when ignoreMaskedFailures is set to true", async () => {
    mockExecutor.defaultResult = {
      exitCode: 0,
      stdout: "FAIL packages/agent/src/index.test.ts\nTests: 2 failed, 10 passed",
      stderr: "",
      timedOut: false,
      truncated: false
    };

    const res = await tool.execute(
      { command: "npm test", ignoreMaskedFailures: true },
      context
    );
    expect(res.success).toBe(true);
    expect(res.output?.maskedFailure).toBeUndefined();
  });

  it("detects Windows shell error masked by compound command", async () => {
    mockExecutor.defaultResult = {
      exitCode: 0,
      stdout: "The system cannot find the file specified.\ndone\n",
      stderr: "",
      timedOut: false,
      truncated: false
    };

    const res = await tool.execute(
      { command: "dir nonexistent & echo done" },
      context
    );
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("MASKED_COMMAND_FAILURE");
    expect(res.error?.message).toContain("Windows system cannot find file specified");
    expect(res.output?.maskedFailure).toBe(true);
  });

  it("executes command in specified sub-directory when cwd is provided", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-cwd-test-"));
    try {
      const subDir = path.join(tmpDir, "packages", "agent");
      await fs.mkdir(subDir, { recursive: true });

      mockExecutor.defaultResult = {
        exitCode: 0,
        stdout: "Agent tests passed\n",
        stderr: "",
        timedOut: false,
        truncated: false
      };

      const res = await tool.execute(
        { command: "npm test", cwd: "packages/agent" },
        { cwd: tmpDir, signal: controller.signal }
      );

      expect(res.success).toBe(true);
      expect(mockExecutor.executedCommands).toHaveLength(1);
      expect(mockExecutor.executedCommands[0].options.cwd).toBe(subDir);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects cwd traversal outside workspace root with PATH_OUT_OF_BOUNDS", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-cwd-test-"));
    try {
      const res = await tool.execute(
        { command: "npm test", cwd: "../../outside" },
        { cwd: tmpDir, signal: controller.signal }
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe("PATH_OUT_OF_BOUNDS");
      expect(mockExecutor.executedCommands).toHaveLength(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects non-existent cwd directory with NOT_FOUND", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-cwd-test-"));
    try {
      const res = await tool.execute(
        { command: "npm test", cwd: "nonexistent_dir" },
        { cwd: tmpDir, signal: controller.signal }
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe("NOT_FOUND");
      expect(res.error?.message).toContain("does not exist");
      expect(mockExecutor.executedCommands).toHaveLength(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects cwd that points to a file with NOT_A_DIRECTORY", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-cwd-test-"));
    try {
      const filePath = path.join(tmpDir, "file.txt");
      await fs.writeFile(filePath, "sample content");

      const res = await tool.execute(
        { command: "npm test", cwd: "file.txt" },
        { cwd: tmpDir, signal: controller.signal }
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe("NOT_A_DIRECTORY");
      expect(res.error?.message).toContain("not a directory");
      expect(mockExecutor.executedCommands).toHaveLength(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

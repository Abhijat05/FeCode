import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { NodeCommandExecutor } from "./nodeExecutor.js";

describe("NodeCommandExecutor", () => {
  let tmpDir: string;
  let executor: NodeCommandExecutor;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-cmd-test-"));
    executor = new NodeCommandExecutor();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("executes valid allowed command and captures stdout and exit code", async () => {
    const res = await executor.execute("node -e \"console.log('hello from node')\"", {
      cwd: tmpDir
    });

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("hello from node");
    expect(res.timedOut).toBe(false);
    expect(res.truncated).toBe(false);
  });

  it("captures non-zero exit code and stderr output", async () => {
    const res = await executor.execute("node -e \"console.error('custom error') , process.exit(42)\"", {
      cwd: tmpDir
    });

    expect(res.exitCode).toBe(42);
    expect(res.stderr).toContain("custom error");
    expect(res.timedOut).toBe(false);
  });

  it("terminates long-running process when timeout is exceeded", async () => {
    const res = await executor.execute("node -e \"setTimeout(() => {}, 10000)\"", {
      cwd: tmpDir,
      timeoutMs: 150
    });

    expect(res.timedOut).toBe(true);
    expect(res.exitCode).toBeNull();
    expect(res.error?.toLowerCase()).toContain("timed out");
  });

  it("terminates process cleanly when AbortSignal is cancelled", async () => {
    const controller = new AbortController();

    const promise = executor.execute("node -e \"setTimeout(() => {}, 10000)\"", {
      cwd: tmpDir,
      signal: controller.signal
    });

    setTimeout(() => {
      controller.abort();
    }, 50);

    const res = await promise;
    expect(res.error?.toLowerCase()).toContain("aborted");
  });

  it("rejects unpermitted commands with COMMAND_NOT_ALLOWED error result", async () => {
    const res = await executor.execute("python -c \"print('hi')\"", {
      cwd: tmpDir
    });

    expect(res.exitCode).toBeNull();
    expect(res.error).toContain("COMMAND_NOT_ALLOWED");
  });

  it("rejects shell metacharacters with UNSUPPORTED_SHELL_SYNTAX error result", async () => {
    const res = await executor.execute("node -v ; echo bad", {
      cwd: tmpDir
    });

    expect(res.exitCode).toBeNull();
    expect(res.error).toContain("UNSUPPORTED_SHELL_SYNTAX");
  });

  it("truncates output when stdout exceeds maxOutputBytes", async () => {
    const res = await executor.execute("node -e \"console.log('A'.repeat(500))\"", {
      cwd: tmpDir,
      maxOutputBytes: 100
    });

    expect(res.truncated).toBe(true);
    expect(res.stdout).toContain("... [output truncated");
  });

  it("enforces ToolContext.cwd for child process execution", async () => {
    const res = await executor.execute("node -e \"console.log(process.cwd())\"", {
      cwd: tmpDir
    });

    expect(res.exitCode).toBe(0);
    expect(path.normalize(res.stdout.trim())).toBe(path.normalize(tmpDir));
  });

  it("preserves PATH while filtering sensitive API keys from child environment", async () => {
    const res = await executor.execute(
      "node -e \"console.log(Boolean(process.env.PATH) + ',' + Boolean(process.env.GEMINI_API_KEY))\"",
      {
        cwd: tmpDir,
        env: { GEMINI_API_KEY: "secret-key-123", PATH: process.env.PATH || "" }
      }
    );

    expect(res.exitCode).toBe(0);
    const [pathPresent, keyPresent] = res.stdout.trim().split(",");
    expect(pathPresent).toBe("true");
    expect(keyPresent).toBe("false");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { NodeCommandExecutor, prepareChildEnvironment } from "./nodeExecutor.js";

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

  it("successfully executes npm command on Windows and other platforms without ENOENT", async () => {
    const res = await executor.execute("npm --version", {
      cwd: tmpDir
    });

    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(res.error).toBeUndefined();
  });

  it("executes batch commands with flags and arguments without throwing DEP0190 or errors", async () => {
    const res = await executor.execute("npm help --help", {
      cwd: tmpDir
    });

    expect(res.exitCode).toBe(0);
    expect(res.error).toBeUndefined();
  });

  it("terminates spawned process tree cleanly when command execution times out", async () => {
    const nestedScript = `
      const { spawn } = require('child_process');
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
        stdio: 'ignore',
        windowsHide: true
      });
      setTimeout(() => {}, 60000);
    `;

    const res = await executor.execute(
      `node -e "${nestedScript.replace(/\n/g, " ").replace(/"/g, '\\"')}"`,
      {
        cwd: tmpDir,
        timeoutMs: 250
      }
    );

    expect(res.timedOut).toBe(true);
    expect(res.exitCode).toBeNull();
    expect(res.error?.toLowerCase()).toContain("timed out");
  });

  it("filters sensitive tokens, passwords, database URLs, and SSH keys from child environment", () => {
    try {
      process.env.GITHUB_TOKEN = "ghp_mock_token_123";
      process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/prod";
      process.env.POSTGRES_PASSWORD = "secret_db_password";
      process.env.SSH_AUTH_SOCK = "/tmp/ssh-agent.sock";
      process.env.AWS_SESSION_TOKEN = "aws_session_123";
      process.env.NPM_TOKEN = "npm_token_123";
      process.env.CUSTOM_CLIENT_SECRET = "secret_abc";

      const childEnv = prepareChildEnvironment();

      expect(childEnv.GITHUB_TOKEN).toBeUndefined();
      expect(childEnv.DATABASE_URL).toBeUndefined();
      expect(childEnv.POSTGRES_PASSWORD).toBeUndefined();
      expect(childEnv.SSH_AUTH_SOCK).toBeUndefined();
      expect(childEnv.AWS_SESSION_TOKEN).toBeUndefined();
      expect(childEnv.NPM_TOKEN).toBeUndefined();
      expect(childEnv.CUSTOM_CLIENT_SECRET).toBeUndefined();
      // Safe environment variables must still be preserved
      expect(childEnv.PATH).toBeDefined();
    } finally {
      delete process.env.GITHUB_TOKEN;
      delete process.env.DATABASE_URL;
      delete process.env.POSTGRES_PASSWORD;
      delete process.env.SSH_AUTH_SOCK;
      delete process.env.AWS_SESSION_TOKEN;
      delete process.env.NPM_TOKEN;
      delete process.env.CUSTOM_CLIENT_SECRET;
    }
  });

  it("sanitizes hostile OSC and screen clear ANSI sequences while preserving safe colors", async () => {
    const nodeCmd = `node -e "const esc = String.fromCharCode(27); const bel = String.fromCharCode(7); process.stdout.write(esc + '[31mError message' + esc + '[0m' + esc + ']52;c;evil_data' + bel + esc + '[2J' + esc + '[H' + esc + '[32mCleaned output' + esc + '[0m');"`;
    const res = await executor.execute(nodeCmd, { cwd: tmpDir });

    expect(res.stdout).toContain("\x1b[31mError message\x1b[0m");
    expect(res.stdout).toContain("\x1b[32mCleaned output\x1b[0m");
    expect(res.stdout).not.toContain("evil_data");
    expect(res.stdout).not.toContain("\x1b[2J");
    expect(res.stdout).not.toContain("\x1b[H");
  });

  it("normalizes deceptive carriage returns in stdout", async () => {
    const nodeCmd = `node -e "process.stdout.write('FAILED tests: 10' + String.fromCharCode(13) + 'PASSED tests: 100' + String.fromCharCode(10));"`;
    const res = await executor.execute(nodeCmd, { cwd: tmpDir });

    expect(res.stdout).toBe("FAILED tests: 10\nPASSED tests: 100\n");
  });

  it("truncates multi-byte Unicode characters safely without leaving invalid lone surrogates", async () => {
    const script = `
      process.stdout.write('AAAA 🚀🚀🚀🚀🚀 BBBB');
    `;
    const res = await executor.execute(
      `node -e "${script.replace(/\n/g, " ").replace(/"/g, '\\"')}"`,
      {
        cwd: tmpDir,
        maxOutputBytes: 11
      }
    );

    expect(res.truncated).toBe(true);
    expect(res.stdout).toContain("... [output truncated due to size limit]");
    // Ensure serialization in JSON doesn't throw or contain broken surrogates
    expect(() => JSON.stringify(res)).not.toThrow();
  });
});

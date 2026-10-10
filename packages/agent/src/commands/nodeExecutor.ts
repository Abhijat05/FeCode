import { spawn, type ChildProcess } from "child_process";
import { killProcessTree } from "./processTree.js";
import { DefaultCommandPolicy, hasUnquotedForbiddenChars } from "./policy.js";
import { sanitizeCommandOutput } from "./outputSanitizer.js";
import type {
  CommandExecutionOptions,
  CommandExecutor,
  CommandPolicy,
  CommandResult
} from "./types.js";

const KNOWN_SENSITIVE_KEYS = new Set([
  "DATABASE_URL",
  "DB_URL",
  "MONGO_URI",
  "MONGODB_URI",
  "REDIS_URL",
  "POSTGRES_URL",
  "MYSQL_URL",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "AWS_SESSION_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "SECRET_KEY"
]);

const SENSITIVE_KEY_PATTERN =
  /(?:_KEY|^KEY|_SECRET|^SECRET|_TOKEN|^TOKEN|_PASSWORD|^PASSWORD|_PASSWD|^PASSWD|AUTH|CREDENTIAL|PRIVATE)/i;

export function isSensitiveEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (KNOWN_SENSITIVE_KEYS.has(upper)) return true;
  if (SENSITIVE_KEY_PATTERN.test(upper)) {
    if (upper.includes("AUTHOR") && !upper.includes("AUTHORIZATION")) {
      return false;
    }
    return true;
  }
  return false;
}

export function prepareChildEnvironment(
  overrides: Record<string, string> = {}
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !isSensitiveEnvKey(key)) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (!isSensitiveEnvKey(key)) {
      env[key] = value;
    }
  }

  return env;
}

export class NodeCommandExecutor implements CommandExecutor {
  private readonly policy: CommandPolicy;

  constructor(policy: CommandPolicy = new DefaultCommandPolicy()) {
    this.policy = policy;
  }

  async execute(
    command: string,
    options: CommandExecutionOptions
  ): Promise<CommandResult> {
    const decision = this.policy.validate(command);
    if (decision.type === "denied") {
      return {
        command,
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        truncated: false,
        error: `${decision.code}: ${decision.reason}`
      };
    }

    const executable = decision.executable!;
    const args = decision.args || [];
    const timeoutMs = options.timeoutMs ?? 30000;
    const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
    const childEnv = prepareChildEnvironment(options.env);

    if (options.signal?.aborted) {
      return {
        command,
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        truncated: false,
        error: "Command execution aborted."
      };
    }

    return new Promise<CommandResult>((resolve) => {
      let child: ChildProcess;
      let timedOut = false;
      let aborted = false;
      let truncated = false;

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;

      const BATCH_EXECUTABLES = new Set(["npm", "npx", "pnpm", "yarn", "bun"]);
      const useShell =
        process.platform === "win32" && BATCH_EXECUTABLES.has(executable.toLowerCase());

      // cmd.exe (used below via shell:true for Windows batch executables) does not
      // honor single quotes as a quoting mechanism, unlike the shell:false argv path.
      // Re-scan with that relaxed-quoting assumption removed so that content like
      // 'x & del /s /q C:\' cannot smuggle a shell metacharacter past policy.validate().
      if (useShell && hasUnquotedForbiddenChars(command.trim(), { honorSingleQuotes: false })) {
        resolve({
          command,
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          truncated: false,
          error:
            "UNSUPPORTED_SHELL_SYNTAX: Command contains shell metacharacters that cannot be safely quoted for Windows batch execution."
        });
        return;
      }

      try {
        if (useShell) {
          // On Windows, batch executables (npm, npx, pnpm, yarn, bun) require the shell.
          // In Node 22+, passing an args array to spawn with shell: true triggers [DEP0190].
          // Node's official deprecation guidance is to pass the full command string with arguments
          // directly as the command parameter and an empty args array.
          child = spawn(command.trim(), [], {
            cwd: options.cwd,
            env: childEnv,
            shell: true,
            windowsHide: true
          });
        } else {
          child = spawn(executable, args, {
            cwd: options.cwd,
            env: childEnv,
            shell: false,
            windowsHide: true
          });
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        resolve({
          command,
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          truncated: false,
          error: `Failed to spawn process: ${errorMsg}`
        });
        return;
      }

      let processClosed = false;
      child.on("close", () => {
        processClosed = true;
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child, "SIGTERM");
        setTimeout(() => {
          if (!processClosed) {
            killProcessTree(child, "SIGKILL");
          }
        }, 1000);
      }, timeoutMs);

      const onAbort = () => {
        aborted = true;
        killProcessTree(child, "SIGTERM");
      };

      if (options.signal) {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      if (child.stdout) {
        child.stdout.on("data", (chunk: Buffer) => {
          if (stdoutBytes < maxOutputBytes) {
            stdoutChunks.push(chunk);
            stdoutBytes += chunk.length;
          } else {
            truncated = true;
          }
        });
      }

      if (child.stderr) {
        child.stderr.on("data", (chunk: Buffer) => {
          if (stderrBytes < maxOutputBytes) {
            stderrChunks.push(chunk);
            stderrBytes += chunk.length;
          } else {
            truncated = true;
          }
        });
      }

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        if (options.signal) {
          options.signal.removeEventListener("abort", onAbort);
        }
        resolve({
          command,
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          truncated: false,
          error: `Process execution error: ${err.message}`
        });
      });

      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        if (options.signal) {
          options.signal.removeEventListener("abort", onAbort);
        }

        const rawStdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const rawStderr = Buffer.concat(stderrChunks).toString("utf-8");

        const sanitizedStdout = sanitizeCommandOutput(rawStdout, {
          maxOutputBytes
        });
        const sanitizedStderr = sanitizeCommandOutput(rawStderr, {
          maxOutputBytes
        });

        const isTruncated =
          truncated ||
          sanitizedStdout.truncated ||
          sanitizedStderr.truncated;

        let errorMessage: string | undefined;
        if (aborted) {
          errorMessage = "Command execution aborted.";
        } else if (timedOut) {
          errorMessage = `Command execution timed out after ${timeoutMs}ms.`;
        }

        resolve({
          command,
          exitCode: timedOut || aborted ? null : code,
          stdout: sanitizedStdout.text,
          stderr: sanitizedStderr.text,
          timedOut,
          truncated: isTruncated,
          error: errorMessage
        });
      });
    });
  }
}

import { spawn, type ChildProcess } from "child_process";
import { DefaultCommandPolicy } from "./policy.js";
import type {
  CommandExecutionOptions,
  CommandExecutor,
  CommandPolicy,
  CommandResult
} from "./types.js";

const SENSITIVE_ENV_KEYS = new Set([
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "SECRET_KEY"
]);

export function prepareChildEnvironment(
  overrides: Record<string, string> = {}
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE_ENV_KEYS.has(key)) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (!SENSITIVE_ENV_KEYS.has(key)) {
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

      try {
        child = spawn(executable, args, {
          cwd: options.cwd,
          env: childEnv,
          shell: false
        });
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

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) {
            try {
              child.kill("SIGKILL");
            } catch {
              // ignore
            }
          }
        }, 1000);
      }, timeoutMs);

      const onAbort = () => {
        aborted = true;
        child.kill("SIGTERM");
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

        let stdoutStr = Buffer.concat(stdoutChunks).toString("utf-8");
        let stderrStr = Buffer.concat(stderrChunks).toString("utf-8");

        if (stdoutBytes > maxOutputBytes) {
          stdoutStr =
            stdoutStr.slice(0, maxOutputBytes) +
            "\n... [output truncated due to size limit]";
          truncated = true;
        }

        if (stderrBytes > maxOutputBytes) {
          stderrStr =
            stderrStr.slice(0, maxOutputBytes) +
            "\n... [output truncated due to size limit]";
          truncated = true;
        }

        let errorMessage: string | undefined;
        if (aborted) {
          errorMessage = "Command execution aborted.";
        } else if (timedOut) {
          errorMessage = `Command execution timed out after ${timeoutMs}ms.`;
        }

        resolve({
          command,
          exitCode: code,
          stdout: stdoutStr,
          stderr: stderrStr,
          timedOut,
          truncated,
          error: errorMessage
        });
      });
    });
  }
}

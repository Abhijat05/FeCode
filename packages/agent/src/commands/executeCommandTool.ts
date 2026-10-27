import * as fs from "fs/promises";
import { resolveSafePath } from "../tools/pathUtils.js";
import type { Tool, ToolContext, ToolResult } from "@fecode/models";
import type { CommandExecutor, CommandResult } from "./types.js";
import { NodeCommandExecutor } from "./nodeExecutor.js";
import { TaskManager, getGlobalTaskManager } from "../tasks/taskManager.js";
import { checkGitLockStatus, cleanStaleGitLock } from "../git/gitLockUtils.js";
import { detectMaskedCommandFailure } from "./failureDetector.js";

export interface ExecuteCommandInput {
  command: string;
  cwd?: string;
  isDaemon?: boolean;
  ignoreMaskedFailures?: boolean;
}

export class ExecuteCommandTool
  implements Tool<ExecuteCommandInput, CommandResult> {
  public readonly name = "execute_command";
  public readonly permissionCategory = "execute";
  public readonly description =
    "Execute a controlled development command (npm, npx, pnpm, yarn, bun, node, git) within the project workspace after user approval. DO NOT use this tool to inspect, read, or search files; use read_file, list_directory, or search_files instead.";
  public readonly inputSchema = {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          "The command to execute (e.g. 'npm test', 'npx tsc --noEmit', 'git status'). Only permitted development tools are allowed."
      },
      cwd: {
        type: "string",
        description:
          "Optional working directory relative to the project workspace root in which to execute the command."
      },
      isDaemon: {
        type: "boolean",
        description:
          "Set to true for long-running support processes that are meant to keep running in the background indefinitely and are not expected to finish on their own (e.g., dev servers, file watchers). Defaults to false."
      },
      ignoreMaskedFailures: {
        type: "boolean",
        description:
          "Set to true to ignore failure signatures in output when the command exits with code 0. Defaults to false."
      }
    },
    required: ["command"]
  };

  private readonly executor: CommandExecutor;
  private readonly taskManager: TaskManager;

  constructor(
    executor: CommandExecutor = new NodeCommandExecutor(),
    taskManager: TaskManager = getGlobalTaskManager()
  ) {
    this.executor = executor;
    this.taskManager = taskManager;
  }

  async execute(
    input: ExecuteCommandInput,
    context: ToolContext
  ): Promise<ToolResult<CommandResult>> {
    if (!input || typeof input.command !== "string" || !input.command.trim()) {
      return {
        success: false,
        error: {
          message: "The 'command' argument is required for execute_command.",
          code: "INVALID_ARGUMENT"
        }
      };
    }

    let effectiveCwd = context.cwd;
    if (input.cwd && typeof input.cwd === "string" && input.cwd.trim()) {
      const pathRes = resolveSafePath(context.cwd, input.cwd);
      if ("error" in pathRes) {
        return {
          success: false,
          error: pathRes.error
        };
      }
      try {
        const stats = await fs.stat(pathRes.targetPath);
        if (!stats.isDirectory()) {
          return {
            success: false,
            error: {
              message: `The specified cwd is not a directory: ${input.cwd}`,
              code: "NOT_A_DIRECTORY"
            }
          };
        }
      } catch {
        return {
          success: false,
          error: {
            message: `The specified cwd directory does not exist: ${input.cwd}`,
            code: "NOT_FOUND"
          }
        };
      }
      effectiveCwd = pathRes.targetPath;
    }

    if (input.isDaemon) {
      try {
        const task = await this.taskManager.spawn(input.command, {
          cwd: effectiveCwd,
          signal: context.signal
        });

        if (task.status === "failed") {
          return {
            success: false,
            error: {
              message: task.error || "Failed to spawn background task.",
              code: "EXECUTION_FAILED"
            },
            output: {
              command: input.command,
              exitCode: null,
              stdout: "",
              stderr: task.error || "",
              timedOut: false,
              truncated: false,
              error: task.error,
              taskId: task.id,
              isDaemon: true,
              pid: task.pid,
              logFile: task.logFile
            }
          };
        }

        return {
          success: true,
          output: {
            command: input.command,
            exitCode: null,
            stdout: `[Background task started with ID ${task.id} (PID ${task.pid}). Logs streaming to ${task.logFile}. Use manage_task tool to inspect logs or stop this process.]`,
            stderr: "",
            timedOut: false,
            truncated: false,
            taskId: task.id,
            isDaemon: true,
            pid: task.pid,
            logFile: task.logFile
          }
        };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: {
            message: errMsg,
            code: "EXECUTION_FAILED"
          }
        };
      }
    }

    let result = await this.executor.execute(input.command, {
      cwd: effectiveCwd,
      signal: context.signal
    });

    if (result.error || (result.exitCode !== null && result.exitCode !== 0)) {
      if (
        result.stderr.includes("index.lock") ||
        (result.error && result.error.includes("index.lock"))
      ) {
        const lockStatus = await checkGitLockStatus(effectiveCwd, 5000);
        if (lockStatus?.hasLock && lockStatus.isStale) {
          const cleaned = await cleanStaleGitLock(effectiveCwd, false, 5000);
          if (cleaned.removed) {
            // Auto-recovery retry!
            const retryResult = await this.executor.execute(input.command, {
              cwd: effectiveCwd,
              signal: context.signal
            });
            if (
              !retryResult.error &&
              (retryResult.exitCode === null || retryResult.exitCode === 0)
            ) {
              const retryMasked = !input.ignoreMaskedFailures
                ? detectMaskedCommandFailure(
                    input.command,
                    retryResult.stdout,
                    retryResult.stderr
                  )
                : { hasMaskedFailure: false };

              if (!retryMasked.hasMaskedFailure) {
                return {
                  success: true,
                  output: {
                    ...retryResult,
                    stdout:
                      retryResult.stdout +
                      `\n[Auto-recovery: Cleared stale git lock (${cleaned.lockPath}) and retried command successfully.]`
                  }
                };
              }
            }
            result = retryResult;
          }
        }
      }

      return {
        success: false,
        error: {
          message:
            result.error ||
            `Command exited with non-zero status code: ${result.exitCode}`,
          code: result.timedOut ? "TIMEOUT" : "EXECUTION_FAILED"
        },
        output: result
      };
    }

    // Check for masked command failures when process exited with code 0
    if (!input.ignoreMaskedFailures) {
      const masked = detectMaskedCommandFailure(
        input.command,
        result.stdout,
        result.stderr
      );
      if (masked.hasMaskedFailure) {
        const errorMsg = `Command completed with exit code 0, but failure output was detected: ${masked.reason}`;
        return {
          success: false,
          error: {
            message: errorMsg,
            code: "MASKED_COMMAND_FAILURE"
          },
          output: {
            ...result,
            maskedFailure: true,
            error: errorMsg
          }
        };
      }
    }

    return {
      success: true,
      output: result
    };
  }
}

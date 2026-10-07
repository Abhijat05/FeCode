import type { Tool, ToolContext, ToolResult } from "@fecode/models";
import type { CommandExecutor, CommandResult } from "./types.js";
import { NodeCommandExecutor } from "./nodeExecutor.js";
import { TaskManager, getGlobalTaskManager } from "../tasks/taskManager.js";

export interface ExecuteCommandInput {
  command: string;
  isDaemon?: boolean;
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
      isDaemon: {
        type: "boolean",
        description:
          "Set to true for long-running support processes that are meant to keep running in the background indefinitely and are not expected to finish on their own (e.g., dev servers, file watchers). Defaults to false."
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

    if (input.isDaemon) {
      try {
        const task = await this.taskManager.spawn(input.command, {
          cwd: context.cwd,
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

    const result = await this.executor.execute(input.command, {
      cwd: context.cwd,
      signal: context.signal
    });

    if (result.error || (result.exitCode !== null && result.exitCode !== 0)) {
      return {
        success: false,
        error: {
          message: result.error || `Command exited with non-zero status code: ${result.exitCode}`,
          code: result.timedOut ? "TIMEOUT" : "EXECUTION_FAILED"
        },
        output: result
      };
    }

    return {
      success: true,
      output: result
    };
  }
}

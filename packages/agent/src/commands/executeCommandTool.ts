import type { Tool, ToolContext, ToolResult } from "@fecode/models";
import type { CommandExecutor, CommandResult } from "./types.js";
import { NodeCommandExecutor } from "./nodeExecutor.js";

export interface ExecuteCommandInput {
  command: string;
}

export class ExecuteCommandTool
  implements Tool<ExecuteCommandInput, CommandResult> {
  public readonly name = "execute_command";
  public readonly permissionCategory = "execute";
  public readonly description =
    "Execute a controlled development command within the project workspace after user approval.";
  public readonly inputSchema = {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to execute (e.g. 'npm test', 'npx tsc --noEmit')."
      }
    },
    required: ["command"]
  };

  private readonly executor: CommandExecutor;

  constructor(executor: CommandExecutor = new NodeCommandExecutor()) {
    this.executor = executor;
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

    const result = await this.executor.execute(input.command, {
      cwd: context.cwd,
      signal: context.signal
    });

    if (result.error) {
      return {
        success: false,
        error: {
          message: result.error,
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

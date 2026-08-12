import type {
  CommandExecutionOptions,
  CommandExecutor,
  CommandResult
} from "./types.js";

export class MockCommandExecutor implements CommandExecutor {
  public executedCommands: Array<{ command: string; options: CommandExecutionOptions }> = [];
  public customResponses: Map<string, CommandResult> = new Map();
  public defaultResult: Partial<CommandResult> = {
    exitCode: 0,
    stdout: "mock command output",
    stderr: "",
    timedOut: false,
    truncated: false
  };

  async execute(
    command: string,
    options: CommandExecutionOptions
  ): Promise<CommandResult> {
    this.executedCommands.push({ command, options });

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

    if (this.customResponses.has(command)) {
      return this.customResponses.get(command)!;
    }

    return {
      command,
      exitCode: this.defaultResult.exitCode ?? 0,
      stdout: this.defaultResult.stdout ?? "",
      stderr: this.defaultResult.stderr ?? "",
      timedOut: this.defaultResult.timedOut ?? false,
      truncated: this.defaultResult.truncated ?? false,
      error: this.defaultResult.error
    };
  }
}

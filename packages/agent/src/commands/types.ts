export interface CommandExecutionOptions {
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface CommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  error?: string;
}

export interface CommandExecutor {
  execute(
    command: string,
    options: CommandExecutionOptions
  ): Promise<CommandResult>;
}

export type CommandDecisionType = "allowed" | "denied";

export interface CommandDecision {
  type: CommandDecisionType;
  executable?: string;
  args?: string[];
  reason?: string;
  code?: "COMMAND_NOT_ALLOWED" | "UNSUPPORTED_SHELL_SYNTAX" | "INVALID_COMMAND";
}

export interface CommandPolicy {
  validate(command: string): CommandDecision;
}

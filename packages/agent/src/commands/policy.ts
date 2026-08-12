import type { CommandDecision, CommandPolicy } from "./types.js";

export interface CommandPolicyOptions {
  allowedExecutables?: string[];
}

const DEFAULT_ALLOWED = ["npm", "npx", "pnpm", "yarn", "bun", "node"];

export function hasUnquotedForbiddenChars(commandStr: string): boolean {
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < commandStr.length; i++) {
    const char = commandStr[i];
    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
        quoteChar = "";
      }
    } else {
      if (char === '"' || char === "'") {
        inQuotes = true;
        quoteChar = char;
      } else if (/[;&|><$`]/.test(char)) {
        return true;
      }
    }
  }

  return false;
}

export function tokenizeCommand(commandStr: string): string[] {
  const tokens: string[] = [];
  let currentToken = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < commandStr.length; i++) {
    const char = commandStr[i];

    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
        quoteChar = "";
      } else {
        currentToken += char;
      }
    } else {
      if (char === '"' || char === "'") {
        inQuotes = true;
        quoteChar = char;
      } else if (/\s/.test(char)) {
        if (currentToken.length > 0) {
          tokens.push(currentToken);
          currentToken = "";
        }
      } else {
        currentToken += char;
      }
    }
  }

  if (currentToken.length > 0) {
    tokens.push(currentToken);
  }

  return tokens;
}

export class DefaultCommandPolicy implements CommandPolicy {
  private readonly allowedExecutables: Set<string>;

  constructor(options: CommandPolicyOptions = {}) {
    this.allowedExecutables = new Set(
      options.allowedExecutables || DEFAULT_ALLOWED
    );
  }

  validate(command: string): CommandDecision {
    const trimmed = (command || "").trim();
    if (!trimmed) {
      return {
        type: "denied",
        reason: "Command string is empty.",
        code: "INVALID_COMMAND"
      };
    }

    if (hasUnquotedForbiddenChars(trimmed)) {
      return {
        type: "denied",
        reason: "Command contains unsupported shell metacharacters or chaining syntax.",
        code: "UNSUPPORTED_SHELL_SYNTAX"
      };
    }

    const tokens = tokenizeCommand(trimmed);
    if (tokens.length === 0) {
      return {
        type: "denied",
        reason: "Failed to parse command executable.",
        code: "INVALID_COMMAND"
      };
    }

    const executable = tokens[0];
    if (!this.allowedExecutables.has(executable)) {
      return {
        type: "denied",
        executable,
        reason: `Executable '${executable}' is not permitted by command policy.`,
        code: "COMMAND_NOT_ALLOWED"
      };
    }

    return {
      type: "allowed",
      executable,
      args: tokens.slice(1)
    };
  }
}

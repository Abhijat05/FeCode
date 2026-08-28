export interface CommandDef {
  command: string;
  description: string;
}

export const COMMANDS: CommandDef[] = [
  { command: "/help",           description: "Show available commands & keyboard shortcuts" },
  { command: "/status",         description: "Show current session, model, and project context" },
  { command: "/plan",           description: "Display current active task plan (or /plan <runId>)" },
  { command: "/runs",           description: "List recent durable historical runs" },
  { command: "/run",            description: "Inspect specific historical run by ID (/run <id>)" },
  { command: "/resume",         description: "Prepare and resume task from previous run (/resume <id>)" },
  { command: "/replan",         description: "Request replanning for current task (or /replan <runId>)" },
  { command: "/debug",          description: "Show diagnostics summary for current run" },
  { command: "/diagnostics",    description: "Show complete diagnostic telemetry" },
  { command: "/history",        description: "Show completed tasks in current session" },
  { command: "/tasks",          description: "List session task summaries" },
  { command: "/task",           description: "View task details by index (/task <index>)" },
  { command: "/git",            description: "Inspect git repository status and branch" },
  { command: "/checkpoints",    description: "List available rollback checkpoints" },
  { command: "/checkpoint",     description: "Create a new manual checkpoint" },
  { command: "/recover",        description: "Inspect or initiate checkpoint recovery" },
  { command: "/sessions",       description: "List saved CLI sessions" },
  { command: "/delete-session", description: "Delete a specific saved session (/delete-session <id>)" },
  { command: "/clear",          description: "Clear current terminal conversation history" },
  { command: "/exit",           description: "Persist session and exit FeCode" }
];

/**
 * Returns commands whose command string starts with `prefix`.
 * `prefix` should include the leading `/` e.g. "/he"
 */
export function filterCommands(prefix: string): CommandDef[] {
  if (!prefix.startsWith("/")) return [];
  const lower = prefix.toLowerCase();
  return COMMANDS.filter((c) => c.command.startsWith(lower));
}

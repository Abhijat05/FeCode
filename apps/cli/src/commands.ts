export type CommandCategory = "Navigation" | "Task & Plan" | "History & Recovery" | "System";

export interface CommandDef {
  command: string;
  description: string;
  category?: CommandCategory;
}

export const COMMANDS: CommandDef[] = [
  { command: "/help",           category: "System",             description: "Show available commands & keyboard shortcuts" },
  { command: "/status",         category: "Task & Plan",        description: "Show current session, model, and project context" },
  { command: "/plan",           category: "Navigation",         description: "Display current active task plan (or /plan <runId>)" },
  { command: "/runs",           category: "Navigation",         description: "List recent durable historical runs (/runs [--all] [limit])" },
  { command: "/run",            category: "History & Recovery", description: "Inspect specific historical run by ID (/run <id>)" },
  { command: "/resume",         category: "History & Recovery", description: "Prepare and resume task from previous run (/resume <id>)" },
  { command: "/replan",         category: "Task & Plan",        description: "Request replanning for current task (or /replan <runId>)" },
  { command: "/debug",          category: "System",             description: "Show diagnostics summary for current run" },
  { command: "/diagnostics",    category: "System",             description: "Show complete diagnostic telemetry" },
  { command: "/history",        category: "History & Recovery", description: "Show completed tasks in current session (/history [page])" },
  { command: "/tasks",          category: "Task & Plan",        description: "List session task summaries (/tasks [page])" },
  { command: "/task",           category: "Task & Plan",        description: "View task details by index (/task <index>)" },
  { command: "/git",            category: "Navigation",         description: "Inspect git repository status and branch" },
  { command: "/checkpoints",    category: "History & Recovery", description: "List available rollback checkpoints" },
  { command: "/checkpoint",     category: "History & Recovery", description: "Create a new manual checkpoint" },
  { command: "/recover",        category: "History & Recovery", description: "Inspect or initiate checkpoint recovery" },
  { command: "/sessions",       category: "History & Recovery", description: "List saved CLI sessions (/sessions [page])" },
  { command: "/delete-session", category: "History & Recovery", description: "Delete a specific saved session (/delete-session <id>)" },
  { command: "/clear",          category: "System",             description: "Clear current terminal conversation history" },
  { command: "/exit",           category: "System",             description: "Persist session and exit FeCode" }
];

/**
 * Returns commands whose command string starts with `prefix`.
 * `prefix` should include the leading `/` e.g. "/he"
 */
export function filterCommands(prefix: string): CommandDef[] {
  if (!prefix || !prefix.trim().startsWith("/")) return [];
  const lower = prefix.trim().toLowerCase();
  const matched = COMMANDS.filter((c) => c.command.toLowerCase().startsWith(lower));
  return matched.sort((a, b) => {
    const aLower = a.command.toLowerCase();
    const bLower = b.command.toLowerCase();
    if (aLower === lower && bLower !== lower) return -1;
    if (bLower === lower && aLower !== lower) return 1;
    return 0;
  });
}

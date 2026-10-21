export type ToolCategory = "read" | "mutate" | "execute" | "other";

export interface ToolBadgeInfo {
  category: ToolCategory;
  color: string;
  label: string;
}

/**
 * Categorize tool by safety without emojis — pure semantic ANSI color coding
 */
export function getToolBadgeInfo(toolName: string): ToolBadgeInfo {
  const lower = (toolName || "").toLowerCase();
  if (
    lower.includes("read") ||
    lower.includes("search") ||
    lower.includes("find") ||
    lower.includes("list") ||
    lower.includes("view") ||
    lower.includes("get") ||
    lower.includes("inspect")
  ) {
    return { category: "read", color: "cyan", label: "read" };
  }
  if (
    lower.includes("edit") ||
    lower.includes("write") ||
    lower.includes("replace") ||
    lower.includes("delete") ||
    lower.includes("patch") ||
    lower.includes("create")
  ) {
    return { category: "mutate", color: "yellow", label: "mutate" };
  }
  if (
    lower.includes("command") ||
    lower.includes("bash") ||
    lower.includes("shell") ||
    lower.includes("exec") ||
    lower.includes("run") ||
    lower.includes("test")
  ) {
    return { category: "execute", color: "magenta", label: "execute" };
  }
  return { category: "other", color: "gray", label: "tool" };
}

/**
 * Format compact single-line tool invocation: toolName(target)
 */
export function formatCompactToolInvocation(
  toolName: string,
  target?: string,
  command?: string
): string {
  const arg = target || command || "";
  if (!arg) return toolName;
  return `${toolName}(${arg})`;
}

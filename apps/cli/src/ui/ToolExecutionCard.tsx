import React from "react";
import { Box, Text } from "ink";
import { symbols } from "./symbols.js";
import { getToolBadgeInfo } from "./toolBadgingUtils.js";

export interface ToolCallRecord {
  id: string;
  name: string;
  target?: string;
  category?: "read" | "mutate" | "execute" | "other";
  status: "running" | "success" | "error";
  durationMs?: number;
  error?: string;
  summary?: string;
}

export interface ToolExecutionCardProps {
  toolCall: ToolCallRecord;
}

export function formatToolDuration(ms?: number): string {
  if (ms === undefined || ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function getCleanToolName(name: string): string {
  const lower = (name || "").toLowerCase();
  if (lower === "read_file" || lower === "read") return "Read";
  if (lower === "edit_file" || lower === "edit") return "Edit";
  if (lower === "write_file" || lower === "write") return "Write";
  if (
    lower === "run_command" ||
    lower === "execute_command" ||
    lower === "bash" ||
    lower === "exec" ||
    lower === "cmd"
  ) {
    return "Exec";
  }
  if (lower === "search_files" || lower === "search") return "Search";
  if (lower === "list_directory" || lower === "list") return "List";
  return name;
}

export interface ExplorationSummary {
  filesRead: number;
  searches: number;
  dirsListed: number;
  totalDurationMs: number;
  description: string;
}

export function summarizeExplorations(tools: ToolCallRecord[]): ExplorationSummary | null {
  if (tools.length < 2) return null;

  let filesRead = 0;
  let searches = 0;
  let dirsListed = 0;
  let totalDurationMs = 0;

  for (const t of tools) {
    const lower = t.name.toLowerCase();
    if (lower.includes("read")) filesRead++;
    else if (lower.includes("search")) searches++;
    else if (lower.includes("list")) dirsListed++;
    else filesRead++;

    if (t.durationMs) totalDurationMs += t.durationMs;
  }

  const parts: string[] = [];
  if (filesRead > 0) parts.push(`read ${filesRead} file${filesRead === 1 ? "" : "s"}`);
  if (searches > 0) parts.push(`searched ${searches} pattern${searches === 1 ? "" : "s"}`);
  if (dirsListed > 0) parts.push(`listed ${dirsListed} dir${dirsListed === 1 ? "" : "s"}`);

  const description = `workspace (${parts.join(", ") || `${tools.length} queries`})`;
  return { filesRead, searches, dirsListed, totalDurationMs, description };
}

export const ToolExecutionCard: React.FC<ToolExecutionCardProps> = ({ toolCall }) => {
  const { name, target, status, durationMs, error, summary } = toolCall;
  const badgeInfo = getToolBadgeInfo(name);
  const cleanName = getCleanToolName(name);
  const durationText = formatToolDuration(durationMs);

  const isSuccess = status === "success";
  const isError = status === "error";
  const isRunning = status === "running";

  return (
    <Box flexDirection="row" marginY={0}>
      <Box marginRight={1}>
        {isSuccess && <Text color="green">✓</Text>}
        {isError && <Text color="red">✗</Text>}
        {isRunning && <Text color="cyan">{symbols.play}</Text>}
      </Box>

      <Box marginRight={1}>
        <Text color={badgeInfo.color} bold>
          {cleanName}
        </Text>
      </Box>

      {target && (
        <Box marginRight={1}>
          <Text color="white">{target}</Text>
        </Box>
      )}

      {summary && (
        <Box marginRight={1}>
          <Text color="gray">({summary})</Text>
        </Box>
      )}

      {isError && error && (
        <Box marginRight={1}>
          <Text color="red">({error})</Text>
        </Box>
      )}

      {durationText && (
        <Box>
          <Text color="gray">· {durationText}</Text>
        </Box>
      )}
    </Box>
  );
};

export interface ToolExecutionGroupProps {
  toolCalls: ToolCallRecord[];
  isScrolled?: boolean;
  expanded?: boolean;
}

export const ToolExecutionGroup: React.FC<ToolExecutionGroupProps> = ({
  toolCalls,
  expanded = false
}) => {
  if (!toolCalls || toolCalls.length === 0) return null;

  if (toolCalls.length <= 2) {
    return (
      <Box flexDirection="column" marginY={0}>
        {toolCalls.map((tc) => (
          <ToolExecutionCard key={tc.id} toolCall={tc} />
        ))}
      </Box>
    );
  }

  const successCount = toolCalls.filter((t) => t.status === "success").length;
  const errorCount = toolCalls.filter((t) => t.status === "error").length;
  const totalDurationMs = toolCalls.reduce((acc, t) => acc + (t.durationMs || 0), 0);
  const totalDurationStr = formatToolDuration(totalDurationMs);

  if (expanded || toolCalls.length <= 3) {
    return (
      <Box flexDirection="column" marginY={0}>
        <Box>
          <Text color="gray">┌ </Text>
          <Text color="cyan" bold>{toolCalls.length} tool calls</Text>
          {totalDurationStr ? <Text color="gray"> · {totalDurationStr}</Text> : null}
          <Text color="gray">
            {" "}({successCount} succeeded{errorCount > 0 ? `, ${errorCount} failed` : ""})
          </Text>
        </Box>
        <Box flexDirection="column" marginLeft={1}>
          {toolCalls.map((tc) => (
            <Box key={tc.id} flexDirection="row">
              <Text color="gray">│ </Text>
              <ToolExecutionCard toolCall={tc} />
            </Box>
          ))}
        </Box>
        <Box>
          <Text color="gray">└</Text>
        </Box>
      </Box>
    );
  }

  // Tier-1 Smart Collapsing
  const failures = toolCalls.filter((t) => t.status === "error");
  const successes = toolCalls.filter((t) => t.status === "success");

  const isExploration = (name: string) => {
    const l = name.toLowerCase();
    return l.includes("read") || l.includes("search") || l.includes("list") || l.includes("find");
  };

  const isMutation = (name: string) => {
    const l = name.toLowerCase();
    return (
      l.includes("edit") ||
      l.includes("write") ||
      l.includes("delete") ||
      l.includes("patch") ||
      l.includes("create")
    );
  };

  const routineReads = successes.filter((t) => isExploration(t.name) && !isMutation(t.name));
  const mutations = successes.filter((t) => isMutation(t.name));
  const otherSuccesses = successes.filter((t) => !isExploration(t.name) && !isMutation(t.name));

  const explorationSummary = routineReads.length >= 2 ? summarizeExplorations(routineReads) : null;
  const readsToRender = explorationSummary ? [] : routineReads;

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text color="gray">┌ </Text>
        <Text color="cyan" bold>{toolCalls.length} tool calls</Text>
        {totalDurationStr ? <Text color="gray"> · {totalDurationStr}</Text> : null}
        <Text color="gray">
          {" "}({successCount} succeeded{errorCount > 0 ? `, ${errorCount} failed` : ""})
        </Text>
      </Box>

      <Box flexDirection="column" marginLeft={1}>
        {/* Summarized routine exploration if 2+ read tools */}
        {explorationSummary && (
          <Box flexDirection="row">
            <Text color="gray">│ </Text>
            <Box marginRight={1}><Text color="green">✓</Text></Box>
            <Box marginRight={1}><Text color="cyan" bold>Explored</Text></Box>
            <Box marginRight={1}><Text color="white">{explorationSummary.description}</Text></Box>
            {explorationSummary.totalDurationMs > 0 && (
              <Box><Text color="gray">· {formatToolDuration(explorationSummary.totalDurationMs)}</Text></Box>
            )}
          </Box>
        )}

        {/* Any single read tool that wasn't summarized */}
        {readsToRender.map((tc) => (
          <Box key={tc.id} flexDirection="row">
            <Text color="gray">│ </Text>
            <ToolExecutionCard toolCall={tc} />
          </Box>
        ))}

        {/* All file mutations (high signal) */}
        {mutations.map((tc) => (
          <Box key={tc.id} flexDirection="row">
            <Text color="gray">│ </Text>
            <ToolExecutionCard toolCall={tc} />
          </Box>
        ))}

        {/* Other command executions (capped to recent if many) */}
        {otherSuccesses.slice(-3).map((tc) => (
          <Box key={tc.id} flexDirection="row">
            <Text color="gray">│ </Text>
            <ToolExecutionCard toolCall={tc} />
          </Box>
        ))}
        {otherSuccesses.length > 3 && (
          <Box flexDirection="row">
            <Text color="gray">│ … and {otherSuccesses.length - 3} earlier commands</Text>
          </Box>
        )}

        {/* All failures (always spotlighted) */}
        {failures.map((tc) => (
          <Box key={tc.id} flexDirection="row">
            <Text color="gray">│ </Text>
            <ToolExecutionCard toolCall={tc} />
          </Box>
        ))}
      </Box>

      <Box>
        <Text color="gray">└</Text>
      </Box>
    </Box>
  );
};

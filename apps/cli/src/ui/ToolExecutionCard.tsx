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
  if (lower === "run_command" || lower === "bash" || lower === "exec") return "Exec";
  if (lower === "search_files" || lower === "search") return "Search";
  if (lower === "list_directory" || lower === "list") return "List";
  return name;
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
}

export const ToolExecutionGroup: React.FC<ToolExecutionGroupProps> = ({ toolCalls }) => {
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

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text color="gray">┌ </Text>
        <Text color="cyan" bold>{toolCalls.length} tool calls</Text>
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
};

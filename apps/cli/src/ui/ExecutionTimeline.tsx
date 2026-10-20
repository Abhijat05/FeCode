import React from "react";
import { Box, Text } from "ink";

export interface TimelineItemData {
  id: string;
  type: string;
  timestamp: number;
  title: string;
  description?: string;
  status?: string;
}

export interface GroupedTimelineItem extends TimelineItemData {
  count?: number;
}

export function groupConsecutiveTimelineItems(items: TimelineItemData[]): GroupedTimelineItem[] {
  const result: GroupedTimelineItem[] = [];
  for (const item of items) {
    const isTool = item.type === "tool_call" || item.type === "tool" || item.type === "tool_execution";
    const last = result[result.length - 1];
    const lastIsTool = last && (last.type === "tool_call" || last.type === "tool" || last.type === "tool_execution");

    if (isTool && lastIsTool && last.title === item.title) {
      last.count = (last.count || 1) + 1;
      last.timestamp = item.timestamp;
      if (item.description) {
        last.description = item.description;
      }
      if (item.status) {
        last.status = item.status;
      }
    } else {
      result.push({ ...item, count: 1 });
    }
  }
  return result;
}

export interface ExecutionTimelineProps {
  items?: TimelineItemData[];
  maxItems?: number;
  groupToolCalls?: boolean;
}

export const ExecutionTimeline: React.FC<ExecutionTimelineProps> = ({
  items = [],
  maxItems = 8,
  groupToolCalls = true
}) => {
  if (items.length === 0) {
    return null;
  }

  const grouped = groupToolCalls ? groupConsecutiveTimelineItems(items) : items;
  // Keep history bounded to avoid terminal buffer overflow
  const recentItems = grouped.slice(-maxItems);

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const getStatusIcon = (type: string, status?: string) => {
    if (type === "tool_call" || type === "tool") {
      return <Text color="magenta">⚙</Text>;
    }
    if (type === "verification") {
      return <Text color="cyan">◌</Text>;
    }
    if (type === "approval") {
      return <Text color="yellow">⚠</Text>;
    }
    if (type === "run_event") {
      return <Text color="blue">◉</Text>;
    }

    switch (status?.toLowerCase()) {
      case "completed":
      case "approved":
        return <Text color="green">✓</Text>;
      case "running":
      case "in_progress":
      case "pending":
        return <Text color="yellow">▸</Text>;
      case "failed":
      case "rejected":
        return <Text color="red">✗</Text>;
      case "skipped":
      case "cancelled":
        return <Text color="gray">⊘</Text>;
      case "blocked":
        return <Text color="red">⚠</Text>;
      default:
        return <Text color="gray">•</Text>;
    }
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={0}>
        <Text bold color="gray">
          Timeline (last {recentItems.length} events)
        </Text>
      </Box>
      {recentItems.map((item) => (
        <Box key={item.id || `tl-${item.timestamp}`}>
          <Text color="gray">{formatTimestamp(item.timestamp)} </Text>
          {getStatusIcon(item.type, item.status)}
          <Text color="gray"> </Text>
          <Text color="white">{item.title}</Text>
          {"count" in item && (item as GroupedTimelineItem).count && (item as GroupedTimelineItem).count! > 1 ? (
            <Text color="cyan" bold> (x{(item as GroupedTimelineItem).count})</Text>
          ) : null}
          {item.description && (
            <Text color="gray"> — {item.description}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
};

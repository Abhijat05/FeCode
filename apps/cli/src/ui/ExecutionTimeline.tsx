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

export interface ExecutionTimelineProps {
  items?: TimelineItemData[];
  maxItems?: number;
}

export const ExecutionTimeline: React.FC<ExecutionTimelineProps> = ({
  items = [],
  maxItems = 10
}) => {
  if (items.length === 0) {
    return null;
  }

  // Keep history bounded to avoid terminal buffer overflow
  const recentItems = items.slice(-maxItems);

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case "completed":
      case "approved":
        return <Text color="green">✓</Text>;
      case "running":
      case "pending":
        return <Text color="yellow">●</Text>;
      case "failed":
      case "rejected":
        return <Text color="red">✗</Text>;
      case "skipped":
      case "cancelled":
        return <Text color="gray">⊘</Text>;
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
        <Text bold color="gray">Timeline (last {recentItems.length} events)</Text>
      </Box>
      {recentItems.map((item) => (
        <Box key={item.id || `tl-${item.timestamp}`}>
          {getStatusIcon(item.status)}
          <Text color="gray"> </Text>
          <Text color="white">{item.title}</Text>
          {item.description && (
            <Text color="gray"> — {item.description}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
};

import React from "react";
import { Box, Text } from "ink";

export interface ThinkingBlockProps {
  durationMs: number;
  tokenCount?: number;
  summary?: string;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  durationMs,
  tokenCount,
  summary
}) => {
  if (durationMs <= 0) return null;

  const seconds = (durationMs / 1000).toFixed(1);
  const tokenText = tokenCount !== undefined ? `, ${tokenCount} tokens` : "";
  const header = `Thought for ${seconds}s${tokenText}`;

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={0}>
      <Box>
        <Text color="gray" dimColor>▸ </Text>
        <Text color="gray" dimColor italic>{header}</Text>
      </Box>
      {summary && (
        <Box marginLeft={2}>
          <Text color="gray" dimColor italic>{summary}</Text>
        </Box>
      )}
    </Box>
  );
};

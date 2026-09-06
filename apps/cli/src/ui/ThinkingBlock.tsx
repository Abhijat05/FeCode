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
  if (!durationMs || isNaN(durationMs) || durationMs <= 0) return null;

  const seconds = (durationMs / 1000).toFixed(1);
  const tokenText =
    typeof tokenCount === "number" && !isNaN(tokenCount) && tokenCount > 0
      ? `, ${tokenCount} tokens`
      : "";
  const header = `Thought for ${seconds}s${tokenText}`;

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={0}>
      <Box>
        <Text color="gray" dimColor>▸ </Text>
        <Text color="gray" dimColor italic>{header}</Text>
      </Box>
      {summary && (
        <Box marginLeft={2}>
          <Text color="gray" dimColor italic wrap="wrap">
            {summary.split("\n")[0]}
          </Text>
        </Box>
      )}
    </Box>
  );
};

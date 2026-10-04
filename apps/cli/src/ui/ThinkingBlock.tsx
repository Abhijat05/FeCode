import React from "react";
import { Box, Text } from "ink";

export interface ThinkingBlockProps {
  durationMs: number;
  tokenCount?: number;
  summary?: string;
}

const MAX_SUMMARY_LENGTH = 70;

const formatSummary = (raw?: string): string | null => {
  if (!raw) return null;
  const firstLine = raw.split("\n")[0]?.trim();
  if (!firstLine || firstLine.toLowerCase() === "thinking...") return null;
  if (firstLine.length > MAX_SUMMARY_LENGTH) {
    return firstLine.slice(0, MAX_SUMMARY_LENGTH - 3) + "...";
  }
  return firstLine;
};

const ThinkingBlockComponent: React.FC<ThinkingBlockProps> = ({
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
  const cleanSummary = formatSummary(summary);

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={0}>
      <Box>
        <Text color="gray" dimColor>▸ </Text>
        <Text color="gray" dimColor italic>{header}</Text>
      </Box>
      {cleanSummary && (
        <Box marginLeft={2}>
          <Text color="gray" dimColor italic wrap="truncate-end">
            {cleanSummary}
          </Text>
        </Box>
      )}
    </Box>
  );
};

export const ThinkingBlock = React.memo(ThinkingBlockComponent);


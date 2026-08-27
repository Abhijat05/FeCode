import React from "react";
import { Box, Text } from "ink";
import { MessageBubble } from "./MessageBubble.js";
import { ThinkingBlock } from "./ThinkingBlock.js";

export interface TurnViewProps {
  prompt: string;
  response: string;
  status: "thinking" | "streaming" | "done" | "error" | "cancelled";
  error?: string;
  isLast?: boolean;
  thinkingMs?: number;
  thinkingTokens?: number;
  thinkingSummary?: string;
}

const SEPARATOR = "─".repeat(48);

export const TurnView: React.FC<TurnViewProps> = ({
  prompt,
  response,
  status,
  error,
  isLast = false,
  thinkingMs,
  thinkingTokens,
  thinkingSummary
}) => {
  const isStreaming = status === "streaming" || status === "thinking";
  const hasError = status === "error";

  return (
    <Box flexDirection="column" marginY={0}>
      {/* User message */}
      <MessageBubble role="user" content={prompt} />

      {/* Spacer between user and agent */}
      <Box height={0} />

      {/* Thinking summary if available */}
      {thinkingMs !== undefined && thinkingMs > 0 && (
        <ThinkingBlock
          durationMs={thinkingMs}
          tokenCount={thinkingTokens}
          summary={thinkingSummary}
        />
      )}

      {/* Agent response */}
      <MessageBubble
        role="agent"
        content={response}
        isStreaming={isStreaming && !response && !hasError}
        error={hasError ? (error || "An error occurred.") : undefined}
      />

      {/* Cancelled badge */}
      {status === "cancelled" && (
        <Box marginLeft={2} marginTop={0}>
          <Text color="gray" dimColor>⊘ Cancelled</Text>
        </Box>
      )}

      {/* Turn separator — only between turns, not after the last one */}
      {!isLast && (
        <Box marginTop={1} marginBottom={0}>
          <Text color="gray" dimColor>{SEPARATOR}</Text>
        </Box>
      )}
    </Box>
  );
};

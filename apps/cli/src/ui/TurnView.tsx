import React from "react";
import { Box, Text, useStdout } from "ink";
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
  columns?: number;
}

const TurnViewComponent: React.FC<TurnViewProps> = ({
  prompt,
  response,
  status,
  error,
  isLast = false,
  thinkingMs,
  thinkingTokens,
  thinkingSummary,
  columns: explicitColumns
}) => {
  const { stdout } = useStdout();
  const cols = explicitColumns ?? stdout?.columns ?? 80;
  const sepLength = Math.max(20, Math.min(cols - 2, 80));
  const separator = "─".repeat(sepLength);

  const isStreaming = status === "streaming" || status === "thinking";
  const hasError = status === "error";

  return (
    <Box flexDirection="column" marginY={0}>
      {/* User message */}
      <MessageBubble role="user" content={prompt} />

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
          <Text color="gray" dimColor>{separator}</Text>
        </Box>
      )}
    </Box>
  );
};

export const TurnView = React.memo(TurnViewComponent);

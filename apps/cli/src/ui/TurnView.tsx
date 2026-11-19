import React from "react";
import { Box, Text, useStdout } from "ink";
import { MessageBubble } from "./MessageBubble.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolExecutionGroup, type ToolCallRecord } from "./ToolExecutionCard.js";

export interface TurnViewProps {
  prompt: string;
  response: string;
  status: "thinking" | "streaming" | "done" | "error" | "cancelled";
  error?: string;
  isLast?: boolean;
  thinkingMs?: number;
  thinkingTokens?: number;
  thinkingSummary?: string;
  toolCalls?: ToolCallRecord[];
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
  toolCalls,
  columns: explicitColumns
}) => {
  const { stdout } = useStdout();
  const cols = explicitColumns ?? stdout?.columns ?? 80;
  const sepLength = Math.max(20, Math.min(cols - 2, 120));
  const separator = "─".repeat(sepLength);

  const isStreaming = status === "streaming";
  const hasError = status === "error";

  const displayResponse = React.useMemo(() => {
    if (!toolCalls || toolCalls.length === 0) return response;
    return response.replace(/^✓\s+[^\n]+\s+executed\n?/gm, "");
  }, [response, toolCalls]);

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

      {/* Tool execution cards if any */}
      {toolCalls && toolCalls.length > 0 && (
        <Box marginLeft={1} marginY={0}>
          <ToolExecutionGroup toolCalls={toolCalls} />
        </Box>
      )}

      {/* Agent response */}
      {(status !== "thinking" || displayResponse || hasError) && (
        <MessageBubble
          role="agent"
          content={displayResponse}
          isStreaming={isStreaming && !displayResponse && !hasError}
          error={hasError ? (error || "An error occurred.") : undefined}
        />
      )}

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

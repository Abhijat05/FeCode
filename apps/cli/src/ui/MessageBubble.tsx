import React from "react";
import { Box, Text } from "ink";

export interface MessageBubbleProps {
  role: "user" | "agent";
  content: string;
  isStreaming?: boolean;
  error?: string;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  role,
  content,
  isStreaming = false,
  error
}) => {
  if (role === "user") {
    return (
      <Box flexDirection="column" marginY={0}>
        {/* Role label row */}
        <Box>
          <Text color="green" bold>▶ </Text>
          <Text color="green" bold>You</Text>
        </Box>
        {/* Message content — indented, bright white bold */}
        <Box marginLeft={2}>
          <Text color="whiteBright" bold>{content}</Text>
        </Box>
      </Box>
    );
  }

  // Agent role
  return (
    <Box flexDirection="column" marginY={0}>
      {/* Role label row */}
      <Box>
        <Text color="cyan" dimColor>  fecode</Text>
      </Box>

      {/* Body with left gutter │ */}
      {error ? (
        <Box
          borderStyle="single"
          borderColor="red"
          paddingX={1}
          marginLeft={2}
          flexDirection="column"
        >
          <Text bold color="red">✗ Error</Text>
          <Text color="red">{error}</Text>
        </Box>
      ) : content ? (
        <Box flexDirection="column">
          {content.split("\n").map((line, i) => (
            <Box key={`line-${i}`}>
              <Text color="cyan" dimColor>│ </Text>
              <Text color="white">{line}</Text>
            </Box>
          ))}
        </Box>
      ) : isStreaming ? (
        <Box>
          <Text color="cyan" dimColor>│ </Text>
          <Text color="gray" dimColor>…</Text>
        </Box>
      ) : null}
    </Box>
  );
};

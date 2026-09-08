import React from "react";
import { Box, Text } from "ink";

export interface MessageBubbleProps {
  role: "user" | "agent";
  content: string;
  isStreaming?: boolean;
  error?: string;
}

type Block =
  | { type: "code"; language: string; code: string }
  | { type: "line"; text: string };

function parseBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];
  let inCodeBlock = false;
  let codeLang = "";
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = trimmed.replace(/^`+/, "").trim();
        codeLines = [];
      } else {
        inCodeBlock = false;
        blocks.push({
          type: "code",
          language: codeLang,
          code: codeLines.join("\n")
        });
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
    } else {
      blocks.push({ type: "line", text: line });
    }
  }

  if (inCodeBlock && codeLines.length > 0) {
    blocks.push({
      type: "code",
      language: codeLang,
      code: codeLines.join("\n")
    });
  }

  return blocks;
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
          <Text color="whiteBright" bold wrap="wrap">{content}</Text>
        </Box>
      </Box>
    );
  }

  // Agent role
  const blocks = content ? parseBlocks(content) : [];

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
          <Text color="red" wrap="wrap">{error}</Text>
        </Box>
      ) : content ? (
        <Box flexDirection="column">
          {blocks.map((block, i) => {
            if (block.type === "code") {
              return (
                <Box key={`block-${i}`} flexDirection="column" marginY={0}>
                  <Box>
                    <Text color="cyan" dimColor>│ </Text>
                    <Box
                      borderStyle="round"
                      borderColor="gray"
                      paddingX={1}
                      flexDirection="column"
                    >
                      {block.language ? (
                        <Box marginBottom={0}>
                          <Text color="cyan" dimColor bold>
                            [{block.language}]
                          </Text>
                        </Box>
                      ) : null}
                      {block.code.split("\n").map((cLine, cIdx) => (
                        <Text key={`c-${cIdx}`} color="whiteBright">
                          {cLine || " "}
                        </Text>
                      ))}
                    </Box>
                  </Box>
                </Box>
              );
            }

            return (
              <Box key={`block-${i}`}>
                <Text color="cyan" dimColor>│ </Text>
                <Text color="white" wrap="wrap">{block.text}</Text>
              </Box>
            );
          })}
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

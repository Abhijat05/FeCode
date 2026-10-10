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

export function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  // Patterns: ***bold-italic***, **bold**, __bold__, `code`, *italic*, _italic_, ~~strike~~
  const regex = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*]+)\*|(?<=^|\s)_([^_]+)_(?=$|\s|[.,!?;:])|~~([^~]+)~~)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2] !== undefined) {
      // ***bold italic***
      parts.push(
        <Text key={`bi-${match.index}`} bold italic color="whiteBright">
          {match[2]}
        </Text>
      );
    } else if (match[3] !== undefined) {
      // **bold**
      parts.push(
        <Text key={`b-${match.index}`} bold color="whiteBright">
          {match[3]}
        </Text>
      );
    } else if (match[4] !== undefined) {
      // __bold__
      parts.push(
        <Text key={`b2-${match.index}`} bold color="whiteBright">
          {match[4]}
        </Text>
      );
    } else if (match[5] !== undefined) {
      // `code`
      parts.push(
        <Text key={`c-${match.index}`} color="cyanBright">
          {match[5]}
        </Text>
      );
    } else if (match[6] !== undefined) {
      // *italic*
      parts.push(
        <Text key={`i-${match.index}`} italic>
          {match[6]}
        </Text>
      );
    } else if (match[7] !== undefined) {
      // _italic_
      parts.push(
        <Text key={`i2-${match.index}`} italic>
          {match[7]}
        </Text>
      );
    } else if (match[8] !== undefined) {
      // ~~strike~~
      parts.push(
        <Text key={`s-${match.index}`} strikethrough>
          {match[8]}
        </Text>
      );
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 ? parts[0] : parts;
}

export function renderMarkdownLine(line: string, index: number): React.ReactNode {
  const trimmed = line.trim();

  // Empty line
  if (!trimmed) {
    return (
      <Box key={`l-${index}`} marginY={0}>
        <Text color="cyan" dimColor>│ </Text>
      </Box>
    );
  }

  // Header 1: # Title
  if (/^#\s+(.+)$/.test(trimmed)) {
    const title = trimmed.replace(/^#\s+/, "").replace(/\s+#*$/, "");
    return (
      <Box key={`l-${index}`} marginTop={0} marginBottom={0}>
        <Text color="cyan" dimColor>│ </Text>
        <Text bold color="cyanBright">{renderInlineMarkdown(title)}</Text>
      </Box>
    );
  }

  // Header 2: ## Title
  if (/^##\s+(.+)$/.test(trimmed)) {
    const title = trimmed.replace(/^##\s+/, "").replace(/\s+#*$/, "");
    return (
      <Box key={`l-${index}`} marginTop={0} marginBottom={0}>
        <Text color="cyan" dimColor>│ </Text>
        <Text bold color="cyan">{renderInlineMarkdown(title)}</Text>
      </Box>
    );
  }

  // Header 3: ### Title
  if (/^###\s+(.+)$/.test(trimmed)) {
    const title = trimmed.replace(/^###\s+/, "").replace(/\s+#*$/, "");
    return (
      <Box key={`l-${index}`} marginTop={0} marginBottom={0}>
        <Text color="cyan" dimColor>│ </Text>
        <Text bold color="yellow">{renderInlineMarkdown(title)}</Text>
      </Box>
    );
  }

  // Header 4+: #### Title
  if (/^#{4,6}\s+(.+)$/.test(trimmed)) {
    const title = trimmed.replace(/^#{4,6}\s+/, "").replace(/\s+#*$/, "");
    return (
      <Box key={`l-${index}`} marginTop={0} marginBottom={0}>
        <Text color="cyan" dimColor>│ </Text>
        <Text bold color="white">{renderInlineMarkdown(title)}</Text>
      </Box>
    );
  }

  // Horizontal divider: --- or *** or ___
  if (/^[-*_]{3,}$/.test(trimmed)) {
    return (
      <Box key={`l-${index}`} marginY={0}>
        <Text color="cyan" dimColor>│ </Text>
        <Text color="gray" dimColor>{"─".repeat(40)}</Text>
      </Box>
    );
  }

  // Blockquote: > Quote
  if (/^>\s*(.*)$/.test(trimmed)) {
    const quote = trimmed.replace(/^>\s*/, "");
    return (
      <Box key={`l-${index}`} marginY={0}>
        <Text color="cyan" dimColor>│ </Text>
        <Text color="gray" italic>“ {renderInlineMarkdown(quote)} ”</Text>
      </Box>
    );
  }

  // Unordered list item: - Item, * Item, + Item
  const listMatch = line.match(/^(\s*)([-*+])\s+(.+)$/);
  if (listMatch) {
    const indent = listMatch[1].length;
    const itemText = listMatch[3];
    return (
      <Box key={`l-${index}`} marginY={0}>
        <Text color="cyan" dimColor>│ </Text>
        {indent > 0 && <Text>{" ".repeat(indent)}</Text>}
        <Text color="cyan">• </Text>
        <Text color="white" wrap="wrap">{renderInlineMarkdown(itemText)}</Text>
      </Box>
    );
  }

  // Ordered list item: 1. Item
  const numMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
  if (numMatch) {
    const indent = numMatch[1].length;
    const num = numMatch[2];
    const itemText = numMatch[3];
    return (
      <Box key={`l-${index}`} marginY={0}>
        <Text color="cyan" dimColor>│ </Text>
        {indent > 0 && <Text>{" ".repeat(indent)}</Text>}
        <Text color="cyan">{num}. </Text>
        <Text color="white" wrap="wrap">{renderInlineMarkdown(itemText)}</Text>
      </Box>
    );
  }

  // Standard line
  return (
    <Box key={`l-${index}`}>
      <Text color="cyan" dimColor>│ </Text>
      <Text color="white" wrap="wrap">{renderInlineMarkdown(line)}</Text>
    </Box>
  );
}

const MessageBubbleComponent: React.FC<MessageBubbleProps> = ({
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
  const blocks = React.useMemo(() => (content ? parseBlocks(content) : []), [content]);

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

            return renderMarkdownLine(block.text, i);
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

export const MessageBubble = React.memo(MessageBubbleComponent);


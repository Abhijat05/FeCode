import React from "react";
import { Box, Text, useStdout } from "ink";
import { symbols } from "./symbols.js";

export interface MessageBubbleProps {
  role: "user" | "agent";
  content: string;
  isStreaming?: boolean;
  error?: string;
  columns?: number;
}

export interface CodeHeader {
  language: string;
  filename?: string;
}

export function parseCodeHeader(rawHeader: string): CodeHeader {
  const trimmed = rawHeader.trim();
  if (!trimmed) return { language: "" };

  const fileKeyMatch = trimmed.match(/(?:filename|file)=([^\s]+)/i);
  if (fileKeyMatch) {
    const filename = fileKeyMatch[1];
    const language = trimmed.replace(/(?:filename|file)=[^\s]+/i, "").trim();
    return { language, filename };
  }

  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > 0 && !trimmed.slice(0, colonIdx).includes(" ")) {
    const language = trimmed.slice(0, colonIdx).trim();
    const filename = trimmed.slice(colonIdx + 1).trim();
    return { language, filename: filename || undefined };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 2 && (parts[1].includes(".") || parts[1].includes("/") || parts[1].includes("\\"))) {
    return { language: parts[0], filename: parts[1] };
  }

  return { language: trimmed };
}

type Block =
  | { type: "code"; language: string; filename?: string; code: string }
  | { type: "line"; text: string };

function parseBlocks(content: string): Block[] {
  const lines = content.split(/\r?\n/);
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
        const header = parseCodeHeader(codeLang);
        blocks.push({
          type: "code",
          language: header.language,
          filename: header.filename,
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
    const header = parseCodeHeader(codeLang);
    blocks.push({
      type: "code",
      language: header.language,
      filename: header.filename,
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

export function renderMarkdownLine(line: string, index: number, columns: number = 80): React.ReactNode {
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
    const hrLen = Math.max(20, Math.min(columns - 6, 76));
    return (
      <Box key={`l-${index}`} marginY={0}>
        <Text color="cyan" dimColor>│ </Text>
        <Text color="gray" dimColor>{"─".repeat(hrLen)}</Text>
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

  // Neutralized process output (prevent spoofing)
  if (trimmed.startsWith("[process-output]")) {
    const rawContent = trimmed.replace(/^\[process-output\]\s*/, "");
    return (
      <Box key={`l-${index}`} marginY={0}>
        <Text color="cyan" dimColor>│ </Text>
        <Text color="yellow" bold>[process-output] </Text>
        <Text color="gray" italic wrap="wrap">{renderInlineMarkdown(rawContent)}</Text>
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
  error,
  columns: explicitColumns
}) => {
  const { stdout } = useStdout();
  const effectiveColumns = explicitColumns ?? stdout?.columns ?? 80;
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
        <Text color="cyan" bold>  ◆ fecode</Text>
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
              const lines = block.code.split(/\r?\n/);
              const padWidth = Math.max(2, String(lines.length).length);
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
                      {block.language || block.filename ? (
                        <Box marginBottom={0}>
                          {block.language ? (
                            <Text color="cyan" dimColor bold>
                              {symbols.rule} {block.language} {symbols.rule}
                            </Text>
                          ) : null}
                          {block.filename ? (
                            <Text color="whiteBright" bold>
                              {block.language ? " " : ""}{block.filename}
                            </Text>
                          ) : null}
                        </Box>
                      ) : null}
                      {lines.map((cLine, cIdx) => (
                        <Box key={`c-${cIdx}`}>
                          <Text color="gray" dimColor>
                            {String(cIdx + 1).padStart(padWidth, "0")} │{" "}
                          </Text>
                          <Text color="whiteBright">
                            {cLine || " "}
                          </Text>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Box>
              );
            }

            return renderMarkdownLine(block.text, i, effectiveColumns);
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


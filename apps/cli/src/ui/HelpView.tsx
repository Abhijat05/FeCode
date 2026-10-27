import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { truncateText } from "./AppShell.js";

export interface HelpViewProps {
  terminalRows?: number;
  terminalColumns?: number;
}

export const HelpView: React.FC<HelpViewProps> = ({
  terminalRows,
  terminalColumns
}) => {
  const commands = [
    { cmd: "/help", desc: "Show available commands & keyboard shortcuts" },
    { cmd: "/status", desc: "Show current session, model, and project context" },
    { cmd: "/plan", desc: "Display current active task plan" },
    { cmd: "/plan <id>", desc: "Display specific task plan" },
    { cmd: "/runs", desc: "List recent durable historical runs" },
    { cmd: "/run <id>", desc: "Inspect specific historical run" },
    { cmd: "/resume <id>", desc: "Prepare and resume task from previous run" },
    { cmd: "/replan", desc: "Request replanning for current task" },
    { cmd: "/debug", desc: "Show diagnostics summary for current run" },
    { cmd: "/diagnostics", desc: "Show complete diagnostic telemetry" },
    { cmd: "/history", desc: "Show completed tasks in current session" },
    { cmd: "/tasks", desc: "List session task summaries" },
    { cmd: "/task <num>", desc: "View task details by index" },
    { cmd: "/sessions", desc: "List past sessions" },
    { cmd: "/git", desc: "Inspect git repository status and branch" },
    { cmd: "/checkpoints", desc: "List available rollback checkpoints" },
    { cmd: "/checkpoint", desc: "Create a new manual checkpoint" },
    { cmd: "/recover", desc: "Inspect or initiate checkpoint recovery" },
    { cmd: "/clear", desc: "Clear current terminal conversation history" },
    { cmd: "/exit", desc: "Persist session and exit FeCode" }
  ];

  const shortcuts = [
    { key: "Ctrl+C", desc: "Cancel active generation / approval or exit" },
    { key: "[p]", desc: "Toggle Plan View (in view navigation)" },
    { key: "[r]", desc: "Toggle Run History View (in view navigation)" },
    { key: "[d] ", desc: "Toggle Diagnostics View (in view navigation)" },
    { key: "[?]", desc: "Toggle Help View (or '?' on empty prompt)" },
    { key: "Esc", desc: "Return to Main Execution View / dismiss modal" }
  ];

  const stdoutRows =
    terminalRows ??
    (typeof process !== "undefined" && process.stdout?.rows
      ? process.stdout.rows
      : 24);

  const cols =
    terminalColumns ??
    (typeof process !== "undefined" && process.stdout?.columns
      ? process.stdout.columns
      : 80);

  // Column mode: 2 columns if width >= 75 cols, otherwise 1 column
  const isNarrow = cols < 75;

  // Decide if pagination is needed:
  // When stdoutRows < 24 OR isNarrow, paginate commands so height stays strictly <= 13 lines!
  const needsPagination = stdoutRows < 24 || isNarrow;

  // In 2-column mode: pageSize is 10 commands (5 rows of 2).
  // In 1-column mode: pageSize is 5-6 commands (5-6 rows of 1).
  const pageSize = isNarrow
    ? Math.max(4, Math.min(6, Math.floor(stdoutRows - 12)))
    : 10;

  const totalPages = needsPagination
    ? Math.max(1, Math.ceil(commands.length / pageSize))
    : 1;

  const [page, setPage] = useState(1);
  const currentPage = Math.min(page, totalPages);

  useInput((input, key) => {
    if (totalPages > 1) {
      if (
        key.upArrow ||
        key.leftArrow ||
        input === "p" ||
        input === "P" ||
        key.pageUp
      ) {
        setPage((prev) => Math.max(1, prev - 1));
      } else if (
        key.downArrow ||
        key.rightArrow ||
        input === "n" ||
        input === "N" ||
        key.pageDown
      ) {
        setPage((prev) => Math.min(totalPages, prev + 1));
      }
    }
  });

  const pagedCommands = needsPagination
    ? commands.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : commands;

  // Column widths for 2-column mode:
  const colWidth = Math.floor((cols - 4) / 2);
  const maxCmdDescLen = isNarrow
    ? Math.max(15, cols - 20)
    : Math.max(12, colWidth - 15);
  const maxScDescLen = isNarrow
    ? Math.max(15, cols - 16)
    : Math.max(10, colWidth - 11);

  const half = Math.ceil(pagedCommands.length / 2);
  const col1 = pagedCommands.slice(0, half);
  const col2 = pagedCommands.slice(half);

  // For very compact viewports (stdoutRows < 18), show shortcuts in a single-line footer
  const compactShortcuts = stdoutRows < 18;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginY={0}
    >
      <Box marginBottom={0} justifyContent="space-between">
        <Text bold color="cyan">Available Commands:</Text>
        {totalPages > 1 && (
          <Text color="yellow">
            (Page {currentPage} of {totalPages}) [↑ / ↓ or ← / →]
          </Text>
        )}
      </Box>

      {isNarrow ? (
        // Narrow viewport: 1 column paginated
        <Box flexDirection="column">
          {pagedCommands.map((c, i) => (
            <Box key={`cmd-narrow-${i}`}>
              <Box width={14} flexShrink={0}>
                <Text bold color="white">{c.cmd}</Text>
              </Box>
              <Text color="gray">{truncateText(c.desc, maxCmdDescLen)}</Text>
            </Box>
          ))}
        </Box>
      ) : (
        // 2-column balanced grid
        <Box flexDirection="column">
          {col1.map((c, i) => {
            const c2 = col2[i];
            return (
              <Box key={`cmd-row-${i}`} justifyContent="space-between">
                <Box width="49%">
                  <Box width={14} flexShrink={0}>
                    <Text bold color="white">{c.cmd}</Text>
                  </Box>
                  <Text color="gray">{truncateText(c.desc, maxCmdDescLen)}</Text>
                </Box>
                {c2 ? (
                  <Box width="49%">
                    <Box width={14} flexShrink={0}>
                      <Text bold color="white">{c2.cmd}</Text>
                    </Box>
                    <Text color="gray">{truncateText(c2.desc, maxCmdDescLen)}</Text>
                  </Box>
                ) : (
                  <Box width="49%" />
                )}
              </Box>
            );
          })}
        </Box>
      )}

      <Box marginTop={0} marginBottom={0}>
        <Text bold color="yellow">Keyboard Shortcuts:</Text>
      </Box>
      {compactShortcuts ? (
        <Box>
          <Text color="gray">
            <Text bold color="yellow">Ctrl+C</Text> exit ·{" "}
            <Text bold color="yellow">[p]</Text> plan ·{" "}
            <Text bold color="yellow">[r]</Text> runs ·{" "}
            <Text bold color="yellow">[d] </Text> debug ·{" "}
            <Text bold color="yellow">[?]</Text> help ·{" "}
            <Text bold color="yellow">Esc</Text> main
          </Text>
        </Box>
      ) : isNarrow ? (
        shortcuts.slice(0, 3).map((s, i) => (
          <Box key={`sc-narrow-${i}`}>
            <Box width={10} flexShrink={0}>
              <Text bold color="yellow">{s.key}</Text>
            </Box>
            <Text color="gray">{truncateText(s.desc, maxScDescLen)}</Text>
          </Box>
        ))
      ) : (
        <Box flexDirection="column">
          {[0, 1, 2].map((rowIdx) => {
            const s1 = shortcuts[rowIdx];
            const s2 = shortcuts[rowIdx + 3];
            return (
              <Box key={`sc-row-${rowIdx}`} justifyContent="space-between">
                {s1 ? (
                  <Box width="49%">
                    <Box width={10} flexShrink={0}>
                      <Text bold color="yellow">{s1.key}</Text>
                    </Box>
                    <Text color="gray">{truncateText(s1.desc, maxScDescLen)}</Text>
                  </Box>
                ) : null}
                {s2 ? (
                  <Box width="49%">
                    <Box width={10} flexShrink={0}>
                      <Text bold color="yellow">{s2.key}</Text>
                    </Box>
                    <Text color="gray">{truncateText(s2.desc, maxScDescLen)}</Text>
                  </Box>
                ) : (
                  <Box width="49%" />
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
};

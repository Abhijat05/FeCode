import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

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
    { key: "[d]", desc: "Toggle Diagnostics View (in view navigation)" },
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

  const isNarrow = cols < 70;
  const [page, setPage] = useState(1);
  const pageSize = Math.max(5, Math.min(10, Math.floor(stdoutRows - 12)));
  const totalPages = Math.ceil(commands.length / pageSize);

  useInput((input, key) => {
    if (isNarrow) {
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

  const half = Math.ceil(commands.length / 2);
  const col1 = commands.slice(0, half);
  const col2 = commands.slice(half);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold color="cyan">Available Commands:</Text>
        {isNarrow && (
          <Text color="yellow">
            (Page {page} of {totalPages}) [↑ / ↓ or ← / →]
          </Text>
        )}
      </Box>

      {isNarrow ? (
        // Narrow viewport: Paginated single column
        <Box flexDirection="column">
          {commands
            .slice((page - 1) * pageSize, page * pageSize)
            .map((c, i) => (
              <Box key={`cmd-narrow-${i}`}>
                <Box width={16}>
                  <Text bold color="white">{c.cmd}</Text>
                </Box>
                <Text color="gray">{c.desc}</Text>
              </Box>
            ))}
        </Box>
      ) : (
        // Standard viewport: 2-column balanced grid
        <Box flexDirection="column">
          {col1.map((c, i) => {
            const c2 = col2[i];
            return (
              <Box key={`cmd-row-${i}`} justifyContent="space-between">
                <Box width="48%">
                  <Box width={15}>
                    <Text bold color="white">{c.cmd}</Text>
                  </Box>
                  <Text color="gray">{c.desc}</Text>
                </Box>
                {c2 ? (
                  <Box width="48%">
                    <Box width={15}>
                      <Text bold color="white">{c2.cmd}</Text>
                    </Box>
                    <Text color="gray">{c2.desc}</Text>
                  </Box>
                ) : (
                  <Box width="48%" />
                )}
              </Box>
            );
          })}
        </Box>
      )}

      <Box marginTop={1} marginBottom={0}>
        <Text bold color="yellow">Keyboard Shortcuts:</Text>
      </Box>
      {isNarrow ? (
        shortcuts.map((s, i) => (
          <Box key={`sc-narrow-${i}`}>
            <Box width={16}>
              <Text bold color="yellow">{s.key}</Text>
            </Box>
            <Text color="gray">{s.desc}</Text>
          </Box>
        ))
      ) : (
        <Box flexDirection="column">
          {[0, 1, 2].map((rowIdx) => {
            const s1 = shortcuts[rowIdx];
            const s2 = shortcuts[rowIdx + 3];
            return (
              <Box key={`sc-row-${rowIdx}`} justifyContent="space-between">
                {s1 && (
                  <Box width="48%">
                    <Box width={15}>
                      <Text bold color="yellow">{s1.key}</Text>
                    </Box>
                    <Text color="gray">{s1.desc}</Text>
                  </Box>
                )}
                {s2 ? (
                  <Box width="48%">
                    <Box width={15}>
                      <Text bold color="yellow">{s2.key}</Text>
                    </Box>
                    <Text color="gray">{s2.desc}</Text>
                  </Box>
                ) : (
                  <Box width="48%" />
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
};

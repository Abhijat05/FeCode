import React from "react";
import { Box, Text } from "ink";

export const HelpView: React.FC = () => {
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
    { cmd: "/git", desc: "Inspect git repository status and branch" },
    { cmd: "/checkpoints", desc: "List available rollback checkpoints" },
    { cmd: "/checkpoint", desc: "Create a new manual checkpoint" },
    { cmd: "/recover", desc: "Inspect or initiate checkpoint recovery" },
    { cmd: "/clear", desc: "Clear current terminal conversation history" },
    { cmd: "/exit", desc: "Persist session and exit FeCode" }
  ];

  const shortcuts = [
    { key: "Ctrl+C", desc: "Cancel active generation / approval or exit" },
    { key: "[p]", desc: "Toggle Plan View" },
    { key: "[r]", desc: "Toggle Run History View" },
    { key: "[d]", desc: "Toggle Diagnostics View" },
    { key: "[?]", desc: "Toggle Help View" },
    { key: "Esc", desc: "Return to Main Execution View" }
  ];

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">Available Commands:</Text>
      </Box>
      {commands.map((c, i) => (
        <Box key={`cmd-${i}`}>
          <Box width={18}>
            <Text bold color="white">{c.cmd}</Text>
          </Box>
          <Text color="gray">{c.desc}</Text>
        </Box>
      ))}

      <Box marginTop={1} marginBottom={0}>
        <Text bold color="yellow">Keyboard Shortcuts:</Text>
      </Box>
      {shortcuts.map((s, i) => (
        <Box key={`sc-${i}`}>
          <Box width={18}>
            <Text bold color="yellow">{s.key}</Text>
          </Box>
          <Text color="gray">{s.desc}</Text>
        </Box>
      ))}
    </Box>
  );
};

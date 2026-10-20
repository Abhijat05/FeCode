import React from "react";
import { Box, Text, useInput, useStdout } from "ink";

export interface KeymapViewProps {
  onClose?: () => void;
  terminalColumns?: number;
}

interface ShortcutCategory {
  title: string;
  items: Array<{ key: string; desc: string }>;
}

export const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: "Views & Navigation",
    items: [
      { key: "[p]", desc: "Toggle Plan View" },
      { key: "[r]", desc: "Toggle Run History" },
      { key: "[d]", desc: "Toggle Diagnostics" },
      { key: "[?]", desc: "Toggle Shortcuts & Keymap" },
      { key: "[Esc]", desc: "Return to Main View / dismiss modal" }
    ]
  },
  {
    title: "Conversation & Input",
    items: [
      { key: "[PgUp/PgDn]", desc: "Scroll conversation history" },
      { key: "[Ctrl+P/N]", desc: "Previous / next prompt history" },
      { key: "[↑ / ↓]", desc: "Navigate command suggestions" },
      { key: "[Tab]", desc: "Auto-complete selected command" },
      { key: "[Enter]", desc: "Submit prompt or execute command" }
    ]
  },
  {
    title: "Approvals & Tasks",
    items: [
      { key: "[y / n]", desc: "Quick approve / deny pending tool" },
      { key: "[← / →]", desc: "Toggle Yes / No approval selection" },
      { key: "[[ / ]]", desc: "Scroll long diff lines in approval" },
      { key: "[Ctrl+C]", desc: "Cancel active generation or exit" }
    ]
  }
];

export const KeymapView: React.FC<KeymapViewProps> = ({
  onClose,
  terminalColumns
}) => {
  const { stdout } = useStdout();
  const cols = terminalColumns ?? stdout?.columns ?? 80;
  const isNarrow = cols < 76;

  useInput((input, key) => {
    if (key.escape || input === "?" || input === "q" || input === "Q") {
      onClose?.();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold color="cyan">
          ⌨ FeCode Keyboard Shortcuts & Keymap
        </Text>
        <Text color="gray" dimColor>
          [Esc / ? / q to close]
        </Text>
      </Box>

      <Box flexDirection={isNarrow ? "column" : "row"} flexWrap="wrap">
        {SHORTCUT_CATEGORIES.map((cat) => (
          <Box
            key={cat.title}
            flexDirection="column"
            marginRight={isNarrow ? 0 : 2}
            marginBottom={1}
            minWidth={isNarrow ? undefined : 34}
          >
            <Box marginBottom={0}>
              <Text bold color="yellow">
                ● {cat.title}
              </Text>
            </Box>
            {cat.items.map((item) => (
              <Box key={item.key}>
                <Box width={14} flexShrink={0}>
                  <Text color="cyanBright" bold>
                    {item.key}
                  </Text>
                </Box>
                <Text color="white">{item.desc}</Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>

      <Box
        marginTop={0}
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        justifyContent="space-between"
      >
        <Text color="gray">
          Tip: Type <Text color="cyan">/help</Text> to see all slash commands and detailed usage.
        </Text>
        <Text color="cyan">fe-keymap</Text>
      </Box>
    </Box>
  );
};

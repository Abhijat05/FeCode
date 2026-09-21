import React from "react";
import { Box, Text, useStdout } from "ink";
import type { CommandDef } from "../commands.js";

export interface CommandPaletteProps {
  suggestions: CommandDef[];
  selectedIndex: number;
  maxVisible?: number;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  suggestions,
  selectedIndex,
  maxVisible: explicitMaxVisible
}) => {
  if (suggestions.length === 0) return null;

  const { stdout } = useStdout();
  const effectiveMaxVisible =
    explicitMaxVisible ??
    (stdout?.rows
      ? stdout.rows <= 24
        ? 4
        : stdout.rows <= 32
          ? 5
          : 6
      : 8);

  const clampedIndex = Math.max(0, Math.min(selectedIndex, suggestions.length - 1));
  const startIndex =
    clampedIndex >= effectiveMaxVisible
      ? Math.min(
          clampedIndex - effectiveMaxVisible + 1,
          Math.max(0, suggestions.length - effectiveMaxVisible)
        )
      : 0;

  const visible = suggestions.slice(startIndex, startIndex + effectiveMaxVisible);
  const remaining = suggestions.length - (startIndex + visible.length);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginBottom={0}
    >
      {startIndex > 0 && (
        <Box>
          <Text color="gray" dimColor>  ▲ …{startIndex} more</Text>
        </Box>
      )}
      {visible.map((cmd, idx) => {
        const isSelected = startIndex + idx === clampedIndex;
        return (
          <Box key={cmd.command}>
            <Text color="cyan" bold>{isSelected ? "› " : "  "}</Text>
            <Box width={16}>
              <Text color={isSelected ? "whiteBright" : "white"} bold={isSelected}>
                {cmd.command}
              </Text>
            </Box>
            <Text color="gray">{cmd.description}</Text>
          </Box>
        );
      })}
      {remaining > 0 && (
        <Box>
          <Text color="gray" dimColor>  …{remaining} more</Text>
        </Box>
      )}
    </Box>
  );
};

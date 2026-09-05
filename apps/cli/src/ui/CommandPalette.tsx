import React from "react";
import { Box, Text } from "ink";
import type { CommandDef } from "../commands.js";

export interface CommandPaletteProps {
  suggestions: CommandDef[];
  selectedIndex: number;
}

const MAX_VISIBLE = 8;

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  suggestions,
  selectedIndex
}) => {
  if (suggestions.length === 0) return null;

  const clampedIndex = Math.max(0, Math.min(selectedIndex, suggestions.length - 1));
  const startIndex =
    clampedIndex >= MAX_VISIBLE
      ? Math.min(clampedIndex - MAX_VISIBLE + 1, Math.max(0, suggestions.length - MAX_VISIBLE))
      : 0;

  const visible = suggestions.slice(startIndex, startIndex + MAX_VISIBLE);
  const remaining = suggestions.length - (startIndex + visible.length);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginBottom={0}
    >
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

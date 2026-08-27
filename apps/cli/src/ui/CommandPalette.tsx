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

  const visible = suggestions.slice(0, MAX_VISIBLE);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginBottom={0}
    >
      {visible.map((cmd, idx) => {
        const isSelected = idx === selectedIndex;
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
      {suggestions.length > MAX_VISIBLE && (
        <Box>
          <Text color="gray" dimColor>  …{suggestions.length - MAX_VISIBLE} more</Text>
        </Box>
      )}
    </Box>
  );
};

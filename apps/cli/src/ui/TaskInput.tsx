import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { CommandPalette } from "./CommandPalette.js";
import type { CommandDef } from "../commands.js";

export interface TaskInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  isDisabled?: boolean;
  placeholder?: string;
  label?: string;
  pendingQuery?: string | null;
  suggestions?: CommandDef[];
  selectedSuggestion?: number;
}

export const TaskInput: React.FC<TaskInputProps> = ({
  value,
  onChange,
  onSubmit,
  isDisabled = false,
  placeholder = "Describe task or type /help...",
  label,
  pendingQuery,
  suggestions,
  selectedSuggestion = 0
}) => {
  return (
    <Box flexDirection="column" marginY={0}>
      {!label && (
        <Box marginBottom={0}>
          <Text color="gray" dimColor>{"─".repeat(48)}</Text>
        </Box>
      )}
      {label && (
        <Box marginBottom={0}>
          <Text bold color="white">{label}</Text>
        </Box>
      )}

      {/* Command Palette — shown above input when typing a slash command */}
      {suggestions && suggestions.length > 0 && (
        <CommandPalette
          suggestions={suggestions}
          selectedIndex={selectedSuggestion}
        />
      )}

      <Box>
        <Text color="cyan" bold>› </Text>
        {isDisabled ? (
          <Text color="gray">
            {pendingQuery ? `[queued] ${pendingQuery}` : (value || placeholder)}
          </Text>
        ) : (
          <TextInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            placeholder={placeholder}
          />
        )}
      </Box>
      {isDisabled && pendingQuery && (
        <Box marginTop={0}>
          <Text color="yellow">⏎ Queued: </Text>
          <Text color="white">{pendingQuery}</Text>
          <Text color="gray">  (Ctrl+C to cancel)</Text>
        </Box>
      )}
    </Box>
  );
};


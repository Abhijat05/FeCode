import React from "react";
import { Box, Text, useStdout } from "ink";
import { symbols } from "./symbols.js";
import { EnhancedTextInput } from "./EnhancedTextInput.js";
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
  maxSuggestionsVisible?: number;
  columns?: number;
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
  selectedSuggestion = 0,
  maxSuggestionsVisible,
  columns: explicitColumns
}) => {
  const { stdout } = useStdout();
  const cols = explicitColumns ?? stdout?.columns ?? 80;
  const sepLength = Math.max(20, Math.min(cols - 2, 80));
  const separator = "─".repeat(sepLength);

  const handleInputSubmit = (submittedValue: string) => {
    if (suggestions && suggestions.length > 0) {
      const clamped = Math.max(0, Math.min(selectedSuggestion, suggestions.length - 1));
      const selected = suggestions[clamped];
      if (selected) {
        onSubmit(selected.command);
        return;
      }
    }
    onSubmit(submittedValue);
  };

  return (
    <Box flexDirection="column" marginY={0}>
      {!label && (
        <Box marginBottom={0}>
          <Text color="gray" dimColor>{separator}</Text>
        </Box>
      )}
      {label && (
        <Box marginBottom={0}>
          <Text bold color="white">{label}</Text>
        </Box>
      )}

      <Box flexDirection="row">
        <Box flexShrink={0}>
          <Text color="cyan" bold>{symbols.prompt} </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          {isDisabled ? (
            <Text color="gray" wrap="wrap">
              {pendingQuery ? "Waiting for current task to complete..." : (value || placeholder)}
            </Text>
          ) : (
            <EnhancedTextInput
              value={value}
              onChange={onChange}
              onSubmit={handleInputSubmit}
              placeholder={placeholder}
            />
          )}
        </Box>
      </Box>

      {/* Command Palette — shown below input when typing a slash command */}
      {suggestions && suggestions.length > 0 && (
        <Box marginTop={0}>
          <CommandPalette
            suggestions={suggestions}
            selectedIndex={selectedSuggestion}
            maxVisible={maxSuggestionsVisible}
          />
        </Box>
      )}

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

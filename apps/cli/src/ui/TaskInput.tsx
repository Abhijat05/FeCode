import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export interface TaskInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  isDisabled?: boolean;
  placeholder?: string;
  label?: string;
}

export const TaskInput: React.FC<TaskInputProps> = ({
  value,
  onChange,
  onSubmit,
  isDisabled = false,
  placeholder = "Describe task or type /help...",
  label = "Task"
}) => {
  return (
    <Box flexDirection="column" marginY={0}>
      {label && (
        <Box marginBottom={0}>
          <Text bold color="white">{label}</Text>
        </Box>
      )}
      <Box>
        <Text color="cyan" bold>› </Text>
        {isDisabled ? (
          <Text color="gray">{value || placeholder}</Text>
        ) : (
          <TextInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            placeholder={placeholder}
          />
        )}
      </Box>
    </Box>
  );
};

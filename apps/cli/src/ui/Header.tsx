import React from "react";
import { Box, Text } from "ink";

export interface HeaderProps {
  projectName?: string;
  providerName?: string;
  modelName?: string;
  cwd?: string;
  status?: string;
  sessionId?: string;
}

export const Header: React.FC<HeaderProps> = ({
  projectName = "fecode",
  providerName,
  modelName,
  cwd = process.cwd(),
  status = "idle"
}) => {
  const getStatusBadge = () => {
    switch (status) {
      case "executing":
      case "running":
        return <Text color="green">● LIVE</Text>;
      case "planning":
        return <Text color="cyan">◌ PLANNING</Text>;
      case "awaiting_plan_approval":
      case "awaiting_step_approval":
        return <Text color="yellow">⚠ APPROVAL</Text>;
      case "blocked":
        return <Text color="red">! BLOCKED</Text>;
      case "recovering":
        return <Text color="yellow">◌ RECOVERING</Text>;
      case "completed":
        return <Text color="green">✓ COMPLETED</Text>;
      case "failed":
        return <Text color="red">✗ FAILED</Text>;
      case "cancelled":
        return <Text color="gray">⊘ CANCELLED</Text>;
      case "idle":
      default:
        return <Text color="gray">○ IDLE</Text>;
    }
  };

  const modelInfo = providerName && modelName ? `${providerName}:${modelName}` : undefined;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="cyan">FeCode</Text>
          <Text color="gray"> project: </Text>
          <Text bold color="white">{projectName}</Text>
          {modelInfo && (
            <Text color="gray"> ({modelInfo})</Text>
          )}
        </Box>
        <Box>
          {getStatusBadge()}
        </Box>
      </Box>
      <Box marginTop={0}>
        <Text color="gray">Working directory: </Text>
        <Text color="white">{cwd}</Text>
      </Box>
    </Box>
  );
};

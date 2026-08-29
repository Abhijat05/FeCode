import React from "react";
import { Box, Text } from "ink";

export interface HeaderProps {
  projectName?: string;
  providerName?: string;
  modelName?: string;
  cwd?: string;
  status?: string;
  gitBranch?: string | null;
  isGitClean?: boolean;
  runId?: string;
  elapsedMs?: number;
  sessionId?: string;
}

export const Header: React.FC<HeaderProps> = ({
  projectName = "fecode",
  providerName,
  modelName,
  cwd = process.cwd(),
  status = "idle",
  gitBranch,
  isGitClean = true,
  runId,
  elapsedMs
}) => {
  const getStatusBadge = () => {
    switch (status.toLowerCase()) {
      case "executing":
      case "running":
        return <Text bold color="green">● LIVE (EXECUTING)</Text>;
      case "planning":
        return <Text bold color="cyan">◌ PLANNING</Text>;
      case "verifying":
        return <Text bold color="cyan">◌ VERIFYING</Text>;
      case "awaiting_plan_approval":
      case "awaiting_step_approval":
        return <Text bold color="yellow">⚠ APPROVAL REQUIRED</Text>;
      case "blocked":
        return <Text bold color="red">! BLOCKED</Text>;
      case "recovering":
        return <Text bold color="yellow">◌ RECOVERING</Text>;
      case "completed":
        return <Text bold color="green">✓ COMPLETED</Text>;
      case "failed":
        return <Text bold color="red">✗ FAILED</Text>;
      case "cancelled":
        return <Text bold color="gray">⊘ CANCELLED</Text>;
      case "idle":
      default:
        return <Text color="gray">○ IDLE</Text>;
    }
  };

  const modelInfo = providerName && modelName ? `${providerName}:${modelName}` : undefined;

  const formatElapsed = (ms?: number) => {
    if (ms === undefined || ms <= 0) return "";
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${min}m ${rem}s`;
  };

  const branchDisplay = gitBranch ? (
    <Text>
      <Text color="gray"> │ ⎇ </Text>
      <Text color="cyan">{gitBranch}</Text>
      <Text color="gray"> ● </Text>
      <Text color={isGitClean ? "green" : "yellow"}>
        {isGitClean ? "clean" : "modified"}
      </Text>
    </Text>
  ) : null;

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
          {modelInfo && <Text color="gray"> ({modelInfo})</Text>}
          {branchDisplay}
        </Box>
        <Box>
          {elapsedMs !== undefined && elapsedMs > 0 && (
            <Text color="gray">{formatElapsed(elapsedMs)} </Text>
          )}
          {getStatusBadge()}
        </Box>
      </Box>

      {(cwd || runId) && (
        <Box justifyContent="space-between" marginTop={0}>
          <Box>
            <Text color="gray">Working directory: </Text>
            <Text color="white">{cwd}</Text>
          </Box>
          {runId && (
            <Box>
              <Text color="gray">Run: </Text>
              <Text color="cyan">{runId.slice(0, 16)}</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

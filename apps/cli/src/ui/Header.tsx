import React from "react";
import { Box, Text } from "ink";
import { formatCwd } from "./pathUtils.js";

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
  elapsedMs,
  sessionId
}) => {
  const getStatusBadge = () => {
    switch (status.toLowerCase()) {
      case "in_progress":
      case "generating":
      case "executing":
      case "running":
        return <Text bold color="green">● LIVE (EXECUTING)</Text>;
      case "planning":
        return <Text bold color="cyan">● PLANNING</Text>;
      case "verifying":
        return <Text bold color="cyan">● VERIFYING</Text>;
      case "awaiting_plan_approval":
      case "awaiting_step_approval":
        return <Text bold color="yellow">⚠ APPROVAL REQUIRED</Text>;
      case "blocked":
        return <Text bold color="red">! BLOCKED</Text>;
      case "recovering":
        return <Text bold color="yellow">● RECOVERING</Text>;
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
      <Text color="gray">⎇ </Text>
      <Text color="cyan">{gitBranch}</Text>
      <Text color="gray"> ● </Text>
      <Text color={isGitClean ? "green" : "yellow"}>
        {isGitClean ? "clean" : "modified"}
      </Text>
    </Text>
  ) : null;

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      width="100%"
      marginBottom={0}
      flexWrap="wrap"
    >
      <Box flexDirection="row" flexWrap="wrap">
        <Box marginRight={1}><Text bold color="cyan">FeCode</Text></Box>
        <Box marginRight={1}><Text bold color="white">{projectName}</Text></Box>
        {branchDisplay && <Box marginRight={1}>{branchDisplay}</Box>}
        {modelInfo && <Box marginRight={1}><Text color="gray">({modelInfo})</Text></Box>}
        {cwd && <Box marginRight={1}><Text color="gray">{formatCwd(cwd)}</Text></Box>}
        {runId ? (
          <Box marginRight={1}><Text color="gray">Run: <Text color="cyan">{runId.slice(0, 16)}</Text></Text></Box>
        ) : sessionId ? (
          <Box marginRight={1}><Text color="gray">Session: <Text color="gray">{sessionId.slice(0, 16)}</Text></Text></Box>
        ) : null}
      </Box>

      <Box flexDirection="row" flexShrink={0}>
        {elapsedMs !== undefined && elapsedMs > 0 && (
          <Text color="gray">{formatElapsed(elapsedMs)} </Text>
        )}
        {getStatusBadge()}
      </Box>
    </Box>
  );
};

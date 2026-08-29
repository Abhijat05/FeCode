import React from "react";
import { Box, Text } from "ink";

export interface WorkspaceStatusProps {
  cwd?: string;
  branch?: string | null;
  isClean?: boolean;
  riskLevel?: string;
  checkpointRequired?: boolean;
  approvalRequired?: boolean;
  modifiedFiles?: string[];
  stagedFiles?: string[];
  untrackedFiles?: string[];
  hasDrift?: boolean;
  driftReason?: string;
  isStale?: boolean;
  staleReason?: string;
  reconciliationState?: string;
  formattedOutput?: string;
}

export const WorkspaceStatus: React.FC<WorkspaceStatusProps> = ({
  cwd = process.cwd(),
  branch,
  isClean = true,
  riskLevel = "low",
  checkpointRequired = false,
  approvalRequired = false,
  modifiedFiles = [],
  stagedFiles = [],
  untrackedFiles = [],
  hasDrift = false,
  driftReason,
  isStale = false,
  staleReason,
  reconciliationState,
  formattedOutput
}) => {
  if (formattedOutput) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        marginY={1}
      >
        <Box marginBottom={0}>
          <Text bold color="cyan">
            Git & Workspace Status
          </Text>
        </Box>
        <Text color="white">{formattedOutput}</Text>
      </Box>
    );
  }

  const getRiskColor = (risk: string) => {
    switch (risk.toLowerCase()) {
      case "critical":
        return "red";
      case "elevated":
      case "high":
        return "yellow";
      case "low":
        return "green";
      case "normal":
      default:
        return "cyan";
    }
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between" marginBottom={0}>
        <Text bold color="cyan">
          Git & Workspace Status
        </Text>
        <Box>
          <Text color="gray">Risk: </Text>
          <Text bold color={getRiskColor(riskLevel)}>
            {riskLevel.toUpperCase()}
          </Text>
        </Box>
      </Box>

      <Box marginTop={0}>
        <Text color="gray">Directory: </Text>
        <Text color="white">{cwd}</Text>
      </Box>

      {branch !== undefined && (
        <Box marginTop={0} justifyContent="space-between">
          <Box>
            <Text color="gray">Branch: </Text>
            <Text color="cyan">{branch || "(detached / none)"}</Text>
            <Text color="gray"> | State: </Text>
            <Text color={isClean ? "green" : "yellow"}>
              {isClean ? "clean" : "modified"}
            </Text>
          </Box>
          <Box>
            <Text color="gray">Checkpoint: </Text>
            <Text color={checkpointRequired ? "yellow" : "gray"}>
              {checkpointRequired ? "REQUIRED" : "OPTIONAL"}
            </Text>
            <Text color="gray"> | Approval: </Text>
            <Text color={approvalRequired ? "yellow" : "gray"}>
              {approvalRequired ? "REQUIRED" : "NONE"}
            </Text>
          </Box>
        </Box>
      )}

      {hasDrift && (
        <Box marginTop={0}>
          <Text color="yellow" bold>
            ⚠ Workspace drift: {driftReason || "State changed outside session"}
          </Text>
        </Box>
      )}

      {isStale && (
        <Box marginTop={0}>
          <Text color="red" bold>
            ⚠ Plan stale: {staleReason || "Prerequisites or files modified"}
          </Text>
        </Box>
      )}

      {reconciliationState && (
        <Box marginTop={0}>
          <Text color="gray">Reconciliation: </Text>
          <Text color="white">{reconciliationState}</Text>
        </Box>
      )}

      {modifiedFiles.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="gray">Modified ({modifiedFiles.length}):</Text>
          {modifiedFiles.slice(0, 4).map((f, i) => (
            <Text key={`mod-${i}`} color="yellow">
              {"  "}M {f}
            </Text>
          ))}
          {modifiedFiles.length > 4 && (
            <Text color="gray">  ... and {modifiedFiles.length - 4} more</Text>
          )}
        </Box>
      )}

      {stagedFiles.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="gray">Staged ({stagedFiles.length}):</Text>
          {stagedFiles.slice(0, 4).map((f, i) => (
            <Text key={`stg-${i}`} color="green">
              {"  "}A {f}
            </Text>
          ))}
        </Box>
      )}

      {untrackedFiles.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="gray">Untracked ({untrackedFiles.length}):</Text>
          {untrackedFiles.slice(0, 4).map((f, i) => (
            <Text key={`unt-${i}`} color="gray">
              {"  "}? {f}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
};

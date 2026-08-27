import React from "react";
import { Box, Text } from "ink";

export interface WorkspaceStatusProps {
  cwd?: string;
  branch?: string | null;
  isClean?: boolean;
  modifiedFiles?: string[];
  stagedFiles?: string[];
  untrackedFiles?: string[];
  hasDrift?: boolean;
  driftReason?: string;
  formattedOutput?: string;
}

export const WorkspaceStatus: React.FC<WorkspaceStatusProps> = ({
  cwd = process.cwd(),
  branch,
  isClean = true,
  modifiedFiles = [],
  stagedFiles = [],
  untrackedFiles = [],
  hasDrift = false,
  driftReason,
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
          <Text bold color="cyan">Git & Workspace Status</Text>
        </Box>
        <Text color="white">{formattedOutput}</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={0}>
        <Text bold color="cyan">Git & Workspace Status</Text>
      </Box>

      <Box marginTop={0}>
        <Text color="gray">Directory: </Text>
        <Text color="white">{cwd}</Text>
      </Box>

      {branch !== undefined && (
        <Box marginTop={0}>
          <Text color="gray">Branch: </Text>
          <Text color="cyan">{branch || "(detached / none)"}</Text>
          <Text color="gray"> | State: </Text>
          <Text color={isClean ? "green" : "yellow"}>
            {isClean ? "clean" : "modified"}
          </Text>
        </Box>
      )}

      {hasDrift && (
        <Box marginTop={0}>
          <Text color="yellow" bold>
            ⚠ Workspace drift detected: {driftReason || "Files changed outside session"}
          </Text>
        </Box>
      )}

      {modifiedFiles.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="gray">Modified ({modifiedFiles.length}):</Text>
          {modifiedFiles.slice(0, 5).map((f, i) => (
            <Text key={`mod-${i}`} color="yellow">
              {"  "}M {f}
            </Text>
          ))}
          {modifiedFiles.length > 5 && (
            <Text color="gray">  ... and {modifiedFiles.length - 5} more</Text>
          )}
        </Box>
      )}

      {stagedFiles.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="gray">Staged ({stagedFiles.length}):</Text>
          {stagedFiles.slice(0, 5).map((f, i) => (
            <Text key={`stg-${i}`} color="green">
              {"  "}A {f}
            </Text>
          ))}
        </Box>
      )}

      {untrackedFiles.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="gray">Untracked ({untrackedFiles.length}):</Text>
          {untrackedFiles.slice(0, 5).map((f, i) => (
            <Text key={`unt-${i}`} color="gray">
              {"  "}? {f}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
};

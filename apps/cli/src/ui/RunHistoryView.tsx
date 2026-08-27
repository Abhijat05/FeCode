import React from "react";
import { Box, Text } from "ink";

export interface HistoricalRunItem {
  runId: string;
  status: string;
  userRequestSummary?: string;
  durationMs?: number;
  startedAt?: number;
  projectId?: string;
}

export interface RunHistoryViewProps {
  runs?: HistoricalRunItem[];
  formattedOutput?: string;
}

export const RunHistoryView: React.FC<RunHistoryViewProps> = ({
  runs = [],
  formattedOutput
}) => {
  if (formattedOutput) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="cyan"
        paddingX={1}
        marginY={1}
      >
        <Box marginBottom={0}>
          <Text bold color="cyan">Recent Runs</Text>
        </Box>
        <Text color="white">{formattedOutput}</Text>
      </Box>
    );
  }

  const getStatusDisplay = (status: string) => {
    switch (status.toLowerCase()) {
      case "completed":
      case "done":
        return <Text color="green">✓ DONE</Text>;
      case "failed":
      case "error":
        return <Text color="red">✗ FAILED</Text>;
      case "cancelled":
      case "cancel":
        return <Text color="gray">⊘ CANCEL</Text>;
      case "running":
      case "executing":
        return <Text color="yellow">● RUNNING</Text>;
      case "blocked":
        return <Text color="red">! BLOCKED</Text>;
      default:
        return <Text color="gray">○ {status.toUpperCase()}</Text>;
    }
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return "0s";
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `${min}m ${remSec}s`;
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={0}>
        <Text bold color="cyan">Recent Runs</Text>
      </Box>

      {runs.length === 0 ? (
        <Box marginTop={0}>
          <Text color="gray">No recorded historical runs found.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={0}>
          <Box justifyContent="space-between" marginBottom={0}>
            <Box width="15%">
              <Text bold color="gray">STATUS</Text>
            </Box>
            <Box width="25%">
              <Text bold color="gray">RUN ID</Text>
            </Box>
            <Box width="45%">
              <Text bold color="gray">REQUEST / PLAN</Text>
            </Box>
            <Box width="15%">
              <Text bold color="gray">TIME</Text>
            </Box>
          </Box>
          {runs.map((r, idx) => (
            <Box key={`run-${r.runId || idx}`} justifyContent="space-between">
              <Box width="15%">{getStatusDisplay(r.status)}</Box>
              <Box width="25%">
                <Text color="white">{r.runId.substring(0, 16)}</Text>
              </Box>
              <Box width="45%">
                <Text color="white">
                  {(r.userRequestSummary || "Untitled task").substring(0, 35)}
                </Text>
              </Box>
              <Box width="15%">
                <Text color="gray">{formatDuration(r.durationMs)}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">
          Inspect run details: <Text color="cyan">/run &lt;id&gt;</Text> | Resume run:{" "}
          <Text color="cyan">/resume &lt;id&gt;</Text>
        </Text>
      </Box>
    </Box>
  );
};

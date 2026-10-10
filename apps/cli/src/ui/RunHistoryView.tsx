import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

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
  projectId?: string;
  isAll?: boolean;
  terminalRows?: number;
  pageSize?: number;
}

export const RunHistoryView: React.FC<RunHistoryViewProps> = ({
  runs = [],
  formattedOutput,
  projectId,
  isAll = false,
  terminalRows,
  pageSize
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

  const stdoutRows =
    terminalRows ??
    (typeof process !== "undefined" && process.stdout?.rows
      ? process.stdout.rows
      : 24);

  const calculatedPageSize =
    pageSize ?? Math.max(4, Math.min(10, Math.floor(stdoutRows - 12)));

  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(runs.length / calculatedPageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pagedRuns = runs.slice(
    (currentPage - 1) * calculatedPageSize,
    currentPage * calculatedPageSize
  );

  useInput((input, key) => {
    if (
      key.upArrow ||
      key.leftArrow ||
      input === "p" ||
      input === "P" ||
      key.pageUp
    ) {
      setPage((prev) => Math.max(1, prev - 1));
    } else if (
      key.downArrow ||
      key.rightArrow ||
      input === "n" ||
      input === "N" ||
      key.pageDown
    ) {
      setPage((prev) => Math.min(totalPages, prev + 1));
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={0}>
        <Text bold color="cyan">
          Recent Runs{isAll ? " (All Projects)" : projectId ? ` (${projectId})` : ""}
        </Text>
      </Box>

      {runs.length === 0 ? (
        <Box marginTop={0}>
          <Text color="gray">
            {isAll
              ? "No recorded historical runs found."
              : "No recorded historical runs found for this project."}
          </Text>
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
          {pagedRuns.map((r, idx) => (
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

      {totalPages > 1 && (
        <Box marginTop={1}>
          <Text color="yellow">
            Showing {(currentPage - 1) * calculatedPageSize + 1}–
            {Math.min(currentPage * calculatedPageSize, runs.length)} of {runs.length} runs (Page {currentPage} of {totalPages})
            {"  "}[↑ / ↓ or ← / → or p / n] Navigate pages
          </Text>
        </Box>
      )}

      <Box marginTop={totalPages > 1 ? 0 : 1}>
        <Text color="gray">
          Inspect run details: <Text color="cyan">/run &lt;id&gt;</Text> | Resume run:{" "}
          <Text color="cyan">/resume &lt;id&gt;</Text>
          {!isAll && (
            <>
              {" "}| All projects: <Text color="cyan">/runs --all</Text>
            </>
          )}
        </Text>
      </Box>
    </Box>
  );
};

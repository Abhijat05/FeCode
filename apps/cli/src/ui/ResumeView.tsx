import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export interface ResumeViewProps {
  runId: string;
  status?: string;
  duration?: string;
  originalRequest?: string;
  workspaceDrift?: string[];
  riskLevel?: string;
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
}

export const ResumeView: React.FC<ResumeViewProps> = ({
  runId,
  status = "FAILED",
  duration,
  originalRequest,
  workspaceDrift = [],
  riskLevel = "ELEVATED",
  value,
  onChange,
  onSubmit
}) => {
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="yellow"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={0}>
        <Text bold color="yellow">
          Historical Run (Resume Request)
        </Text>
      </Box>

      <Box marginTop={0}>
        <Text color="gray">ID: </Text>
        <Text color="white" bold>{runId}</Text>
      </Box>

      <Box marginTop={0}>
        <Text color="gray">Status: </Text>
        <Text
          bold
          color={
            status.toLowerCase() === "completed"
              ? "green"
              : status.toLowerCase() === "failed"
                ? "red"
                : "yellow"
          }
        >
          {status.toUpperCase()}
        </Text>
        {duration && <Text color="gray"> | Duration: {duration}</Text>}
      </Box>

      {originalRequest && (
        <Box marginTop={0} flexDirection="column">
          <Text color="gray">Original request:</Text>
          <Text color="white">{originalRequest}</Text>
        </Box>
      )}

      {workspaceDrift.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="gray">Workspace drift:</Text>
          {workspaceDrift.map((d, i) => (
            <Text key={`drift-${i}`} color="yellow">
              {"  "}⚠ {d}
            </Text>
          ))}
        </Box>
      )}

      {riskLevel && (
        <Box marginTop={0}>
          <Text color="gray">Risk reassessment: </Text>
          <Text color="yellow" bold>{riskLevel.toUpperCase()}</Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          (Historical approvals/checkpoints must never be reused.)
        </Text>
        <Text color="yellow">Resume this task as a new run? [y/N]</Text>
      </Box>

      <Box marginTop={0}>
        <Text color="yellow" bold>Choice [N]: </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder="n"
        />
      </Box>
    </Box>
  );
};

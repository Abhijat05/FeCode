import React from "react";
import { Box, Text } from "ink";

export interface CurrentStepViewProps {
  stepOrder?: number;
  totalSteps?: number;
  title?: string;
  objective?: string;
  riskLevel?: string;
  checkpointRequired?: boolean;
  verificationRequired?: boolean;
  toolName?: string;
  target?: string;
  command?: string;
  durationMs?: number;
}

export const CurrentStepView: React.FC<CurrentStepViewProps> = ({
  stepOrder,
  totalSteps,
  title,
  objective,
  riskLevel = "normal",
  checkpointRequired = false,
  verificationRequired = false,
  toolName,
  target,
  command,
  durationMs
}) => {
  if (!title && !toolName && !command) {
    return null;
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

  const stepPrefix =
    stepOrder !== undefined && totalSteps !== undefined
      ? `Step ${stepOrder}/${totalSteps}:`
      : "Current Operation:";

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      marginY={0}
    >
      <Box justifyContent="space-between">
        <Box>
          <Text>
            <Text bold color="cyan">▶ {stepPrefix} </Text>
            <Text bold color="white">{title || toolName || command}</Text>
          </Text>
        </Box>
        <Box>
          <Text color="gray">Risk: </Text>
          <Text bold color={getRiskColor(riskLevel)}>
            {riskLevel.toUpperCase()}
          </Text>
        </Box>
      </Box>

      {objective && (
        <Box marginTop={0}>
          <Text color="gray">Goal: </Text>
          <Text color="white">{objective}</Text>
        </Box>
      )}

      <Box marginTop={0} flexWrap="wrap">
        {toolName && (
          <Box marginRight={2}>
            <Text color="gray">Tool: </Text>
            <Text bold color="magenta">
              {toolName}
            </Text>
          </Box>
        )}
        {target && (
          <Box marginRight={2}>
            <Text color="gray">Target: </Text>
            <Text color="cyan">{target}</Text>
          </Box>
        )}
        {command && (
          <Box marginRight={2}>
            <Text color="gray">Command: </Text>
            <Text color="yellow">{command}</Text>
          </Box>
        )}
        {checkpointRequired && (
          <Box marginRight={2}>
            <Text color="yellow">[Checkpoint Required]</Text>
          </Box>
        )}
        {verificationRequired && (
          <Box marginRight={2}>
            <Text color="cyan">[Verification Required]</Text>
          </Box>
        )}
        {durationMs !== undefined && durationMs > 0 && (
          <Box>
            <Text color="gray">
              Elapsed:{" "}
              {durationMs >= 1000
                ? `${(durationMs / 1000).toFixed(1)}s`
                : `${durationMs}ms`}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

import React from "react";
import { Box, Text } from "ink";
import { symbols } from "./symbols.js";
import { getToolBadgeInfo, formatCompactToolInvocation } from "./toolBadgingUtils.js";

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
      paddingLeft={1}
      marginY={0}
    >
      <Box justifyContent="space-between">
        <Box>
          <Text>
            <Text bold color="cyan">{symbols.play} {stepPrefix} </Text>
            <Text bold color="white">{title || toolName || command}</Text>
          </Text>
        </Box>
        <Box>
          <Text color="gray">Risk: </Text>
          <Text bold color={getRiskColor(riskLevel)}>
            {riskLevel.toLowerCase()}
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
            <Text color={getToolBadgeInfo(toolName).color}>{symbols.dot} </Text>
            <Text bold color="white">{formatCompactToolInvocation(toolName, target, command)}</Text>
          </Box>
        )}
        {!toolName && command && (
          <Box marginRight={2}>
            <Text color="yellow">{symbols.dot} bash({command})</Text>
          </Box>
        )}
        {checkpointRequired && (
          <Box marginRight={2}>
            <Text color="yellow">{symbols.bullet} checkpoint required</Text>
          </Box>
        )}
        {verificationRequired && (
          <Box marginRight={2}>
            <Text color="cyan">{symbols.bullet} verify required</Text>
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

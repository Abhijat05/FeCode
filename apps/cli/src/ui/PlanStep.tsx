import React from "react";
import { Box, Text } from "ink";
import { symbols } from "./symbols.js";

export interface PlanStepProps {
  stepIndex: number;
  totalSteps: number;
  title: string;
  status:
    | "pending"
    | "planned"
    | "ready"
    | "in_progress"
    | "executing"
    | "verifying"
    | "waiting"
    | "waiting_approval"
    | "completed"
    | "skipped"
    | "blocked"
    | "failed"
    | string;
  riskLevel?: string;
  dependencies?: string[];
  checkpointRequired?: boolean;
  verificationRequired?: boolean;
  durationMs?: number;
  error?: string;
  objective?: string;
}

export const PlanStep: React.FC<PlanStepProps> = ({
  stepIndex,
  totalSteps,
  title,
  status,
  riskLevel,
  checkpointRequired,
  verificationRequired,
  durationMs,
  error
}) => {
  const getStatusIcon = () => {
    switch (status.toLowerCase()) {
      case "completed":
      case "done":
        return <Text color="green">{symbols.tick}</Text>;
      case "in_progress":
      case "executing":
        return <Text color="yellow">{symbols.play}</Text>;
      case "verifying":
        return <Text color="cyan">{symbols.verifying}</Text>;
      case "waiting":
      case "waiting_approval":
        return <Text color="yellow">{symbols.warning}</Text>;
      case "ready":
        return <Text color="gray">{symbols.circle}</Text>;
      case "skipped":
        return <Text color="gray">{symbols.cancelled}</Text>;
      case "blocked":
        return <Text color="red">!</Text>;
      case "failed":
        return <Text color="red">{symbols.cross}</Text>;
      case "pending":
      case "planned":
      default:
        return <Text color="gray">{symbols.circle}</Text>;
    }
  };

  const getStatusLabel = () => {
    switch (status.toLowerCase()) {
      case "completed":
      case "done":
        return <Text color="green">completed</Text>;
      case "in_progress":
      case "executing":
        return <Text color="yellow">running</Text>;
      case "verifying":
        return <Text color="cyan">verifying</Text>;
      case "waiting":
      case "waiting_approval":
        return <Text color="yellow">waiting approval</Text>;
      case "ready":
        return <Text color="blue">ready</Text>;
      case "skipped":
        return <Text color="gray">skipped</Text>;
      case "blocked":
        return <Text color="red">blocked</Text>;
      case "failed":
        return <Text color="red">failed</Text>;
      case "pending":
      case "planned":
      default:
        return <Text color="gray">planned</Text>;
    }
  };

  const getRiskBadge = () => {
    if (!riskLevel || riskLevel.toLowerCase() === "low" || riskLevel.toLowerCase() === "normal") {
      return null;
    }
    const isCrit = riskLevel.toLowerCase() === "critical";
    return <Text color={isCrit ? "red" : "yellow"}> [{riskLevel.toLowerCase()}]</Text>;
  };

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text color="gray">
          {stepIndex}/{totalSteps} {symbols.rule}{" "}
        </Text>
        {getStatusIcon()}
        <Text> </Text>
        <Text
          bold={status === "in_progress" || status === "executing"}
          dimColor={status === "completed" || status === "done" || status === "skipped"}
          color={
            status === "failed" || status === "blocked"
              ? "red"
              : "white"
          }
        >
          {title}
        </Text>
        {getRiskBadge()}
        <Text color="gray"> — </Text>
        {getStatusLabel()}
        {durationMs !== undefined && durationMs > 0 && (
          <Text color="gray">
            {" "}
            (
            {durationMs >= 1000
              ? `${(durationMs / 1000).toFixed(1)}s`
              : `${durationMs}ms`}
            )
          </Text>
        )}
      </Box>

      {/* Meta tags */}
      <Box marginLeft={4}>
        {checkpointRequired && (
          <Text color="yellow">{symbols.bullet} checkpoint required </Text>
        )}
        {verificationRequired && (
          <Text color="cyan">{symbols.bullet} verify required </Text>
        )}
      </Box>

      {error && (
        <Box marginLeft={4}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
    </Box>
  );
};

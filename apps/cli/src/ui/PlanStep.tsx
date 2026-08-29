import React from "react";
import { Box, Text } from "ink";

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
  dependencies,
  checkpointRequired,
  verificationRequired,
  durationMs,
  error
}) => {
  const getStatusIcon = () => {
    switch (status.toLowerCase()) {
      case "completed":
      case "done":
        return <Text color="green">✓</Text>;
      case "in_progress":
      case "executing":
        return <Text color="yellow">●</Text>;
      case "verifying":
        return <Text color="cyan">◌</Text>;
      case "waiting":
      case "waiting_approval":
        return <Text color="yellow">⚠</Text>;
      case "ready":
        return <Text color="blue">◌</Text>;
      case "skipped":
        return <Text color="gray">⊘</Text>;
      case "blocked":
        return <Text color="red">!</Text>;
      case "failed":
        return <Text color="red">✗</Text>;
      case "pending":
      case "planned":
      default:
        return <Text color="gray">○</Text>;
    }
  };

  const getStatusLabel = () => {
    switch (status.toLowerCase()) {
      case "completed":
      case "done":
        return <Text color="green">COMPLETED</Text>;
      case "in_progress":
      case "executing":
        return <Text color="yellow">EXECUTING</Text>;
      case "verifying":
        return <Text color="cyan">VERIFYING</Text>;
      case "waiting":
      case "waiting_approval":
        return <Text color="yellow">WAITING FOR APPROVAL</Text>;
      case "ready":
        return <Text color="blue">READY</Text>;
      case "skipped":
        return <Text color="gray">SKIPPED</Text>;
      case "blocked":
        return <Text color="red">BLOCKED</Text>;
      case "failed":
        return <Text color="red">FAILED</Text>;
      case "pending":
      case "planned":
      default:
        return <Text color="gray">PLANNED</Text>;
    }
  };

  const getRiskBadge = () => {
    if (!riskLevel || riskLevel.toLowerCase() === "low" || riskLevel.toLowerCase() === "normal") {
      return null;
    }
    const isCrit = riskLevel.toLowerCase() === "critical";
    return <Text color={isCrit ? "red" : "yellow"}> [{riskLevel.toUpperCase()}]</Text>;
  };

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text color="gray">
          [{stepIndex}/{totalSteps}]{" "}
        </Text>
        {getStatusIcon()}
        <Text> </Text>
        <Text
          bold={status === "in_progress" || status === "executing"}
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
          <Text color="yellow">[Checkpoint Required] </Text>
        )}
        {verificationRequired && (
          <Text color="cyan">[Verify Required] </Text>
        )}
        {dependencies && dependencies.length > 0 && (
          <Text color="gray">[Deps: {dependencies.join(", ")}] </Text>
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

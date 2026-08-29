import React from "react";
import { Box, Text } from "ink";
import { PlanStep } from "./PlanStep.js";
import { ProgressBar } from "./ProgressBar.js";

export interface PlanStepItem {
  stepId: string;
  order: number;
  title: string;
  objective?: string;
  status: string;
  riskLevel?: string;
  dependencies?: string[];
  checkpointRequired?: boolean;
  verificationRequired?: boolean;
  durationMs?: number;
  error?: string;
}

export interface PlanViewProps {
  planId?: string;
  objective?: string;
  summary?: string;
  status?: string;
  riskLevel?: string;
  steps?: PlanStepItem[];
  completedCount?: number;
  totalCount?: number;
}

export const PlanView: React.FC<PlanViewProps> = ({
  planId,
  objective,
  summary,
  status = "ready",
  riskLevel,
  steps = [],
  completedCount,
  totalCount
}) => {
  const total = totalCount ?? steps.length;
  const completed =
    completedCount ?? steps.filter((s) => s.status === "completed").length;

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
      borderStyle="round"
      borderColor="blue"
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between" marginBottom={0}>
        <Box>
          <Text bold color="blue">
            Plan:{" "}
          </Text>
          <Text bold color="white">
            {objective || summary || "Task Plan"}
          </Text>
          {planId && <Text color="gray"> ({planId})</Text>}
        </Box>
        <Box>
          {riskLevel && (
            <Text color={getRiskColor(riskLevel)} bold>
              [{riskLevel.toUpperCase()}]{" "}
            </Text>
          )}
          <Text color="gray">
            [{completed}/{total}] Status:{" "}
          </Text>
          <Text bold color="cyan">
            {status.toUpperCase()}
          </Text>
        </Box>
      </Box>

      {/* Deterministic Unicode Progress Bar */}
      <Box marginY={0}>
        <ProgressBar completed={completed} total={total} width={24} />
      </Box>

      {steps.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {steps.map((step, idx) => (
            <PlanStep
              key={step.stepId || `step-${idx}`}
              stepIndex={step.order || idx + 1}
              totalSteps={total}
              title={step.title}
              status={step.status}
              riskLevel={step.riskLevel}
              dependencies={step.dependencies}
              checkpointRequired={step.checkpointRequired}
              verificationRequired={step.verificationRequired}
              durationMs={step.durationMs}
              error={step.error}
              objective={step.objective}
            />
          ))}
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color="gray">No steps defined in this plan.</Text>
        </Box>
      )}
    </Box>
  );
};

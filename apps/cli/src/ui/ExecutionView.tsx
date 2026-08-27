import React from "react";
import { Box, Text } from "ink";
import { PlanView, type PlanStepItem } from "./PlanView.js";

export interface ExecutionViewProps {
  runId?: string;
  status?: string;
  userRequest?: string;
  activePlan?: {
    planId?: string;
    objective?: string;
    summary?: string;
    status?: string;
    riskLevel?: string;
    steps?: PlanStepItem[];
    completedStepsCount?: number;
    totalStepsCount?: number;
  };
  activeTool?: {
    toolName: string;
    target?: string;
    callId?: string;
  };
  activeVerification?: {
    command: string;
    attempt?: number;
  };
  activeRecovery?: {
    strategy: string;
    recoveryId?: string;
  };
  streamedOutput?: string;
  completionSummary?: {
    status?: string;
    completedFiles?: string[];
    verifiedCommands?: string[];
    completedRequirements?: string[];
    remainingRequirements?: string[];
    blockedReason?: string;
  };
  error?: string;
}

export const ExecutionView: React.FC<ExecutionViewProps> = ({
  runId,
  status = "idle",
  userRequest,
  activePlan,
  activeTool,
  activeVerification,
  activeRecovery,
  streamedOutput,
  completionSummary,
  error
}) => {
  return (
    <Box flexDirection="column" marginY={0}>
      {/* Active Run Header */}
      {runId && (
        <Box marginBottom={0}>
          <Text color="gray">Run: </Text>
          <Text color="white" bold>{runId}</Text>
          <Text color="gray"> | Status: </Text>
          <Text
            bold
            color={
              status === "executing"
                ? "green"
                : status === "completed"
                  ? "green"
                  : status === "failed"
                    ? "red"
                    : status === "blocked"
                      ? "red"
                      : "cyan"
            }
          >
            {status.toUpperCase()}
          </Text>
        </Box>
      )}

      {/* User Request */}
      {userRequest && (
        <Box marginBottom={1}>
          <Text color="gray">Task: </Text>
          <Text color="white">{userRequest}</Text>
        </Box>
      )}

      {/* Active Plan rendering */}
      {activePlan && activePlan.steps && activePlan.steps.length > 0 && (
        <PlanView
          planId={activePlan.planId}
          objective={activePlan.objective}
          summary={activePlan.summary}
          status={activePlan.status}
          riskLevel={activePlan.riskLevel}
          steps={activePlan.steps}
          completedCount={activePlan.completedStepsCount}
          totalCount={activePlan.totalStepsCount}
        />
      )}

      {/* Active Tool Activity */}
      {activeTool && (
        <Box
          borderStyle="single"
          borderColor="magenta"
          paddingX={1}
          marginY={0}
          flexDirection="column"
        >
          <Box>
            <Text bold color="magenta">Tool: </Text>
            <Text bold color="white">{activeTool.toolName}</Text>
          </Box>
          {activeTool.target && (
            <Box>
              <Text color="gray">Target: </Text>
              <Text color="cyan">{activeTool.target}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Active Verification Activity */}
      {activeVerification && (
        <Box
          borderStyle="single"
          borderColor="cyan"
          paddingX={1}
          marginY={0}
          flexDirection="column"
        >
          <Box>
            <Text bold color="cyan">Verification: </Text>
            <Text bold color="white">{activeVerification.command}</Text>
            {activeVerification.attempt !== undefined && (
              <Text color="gray"> (Attempt {activeVerification.attempt})</Text>
            )}
          </Box>
        </Box>
      )}

      {/* Active Recovery Activity */}
      {activeRecovery && (
        <Box
          borderStyle="single"
          borderColor="yellow"
          paddingX={1}
          marginY={0}
          flexDirection="column"
        >
          <Box>
            <Text bold color="yellow">Recovery: </Text>
            <Text bold color="white">{activeRecovery.strategy}</Text>
            {activeRecovery.recoveryId && (
              <Text color="gray"> ({activeRecovery.recoveryId})</Text>
            )}
          </Box>
        </Box>
      )}

      {/* Live Streamed Output */}
      {streamedOutput && (
        <Box
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          marginY={1}
          flexDirection="column"
        >
          <Text color="white">{streamedOutput}</Text>
        </Box>
      )}

      {/* Completion Summary */}
      {completionSummary && (
        <Box
          borderStyle="single"
          borderColor={completionSummary.status === "completed" ? "green" : "red"}
          paddingX={1}
          marginY={1}
          flexDirection="column"
        >
          <Box>
            <Text
              bold
              color={completionSummary.status === "completed" ? "green" : "red"}
            >
              {completionSummary.status === "completed"
                ? "✓ Task completed"
                : "⚠ Task blocked"}
            </Text>
          </Box>
          {completionSummary.completedFiles &&
            completionSummary.completedFiles.length > 0 && (
              <Box flexDirection="column" marginTop={0}>
                <Text color="gray">Changed:</Text>
                {completionSummary.completedFiles.map((f, i) => (
                  <Text key={`cf-${i}`} color="white">
                    {"  "}• {f}
                  </Text>
                ))}
              </Box>
            )}
          {completionSummary.verifiedCommands &&
            completionSummary.verifiedCommands.length > 0 && (
              <Box flexDirection="column" marginTop={0}>
                <Text color="gray">Verified:</Text>
                {completionSummary.verifiedCommands.map((c, i) => (
                  <Text key={`vc-${i}`} color="white">
                    {"  "}• {c}
                  </Text>
                ))}
              </Box>
            )}
          {completionSummary.blockedReason && (
            <Box marginTop={0}>
              <Text color="red">Reason: {completionSummary.blockedReason}</Text>
            </Box>
          )}
          {completionSummary.remainingRequirements &&
            completionSummary.remainingRequirements.length > 0 && (
              <Box flexDirection="column" marginTop={0}>
                <Text color="yellow">Remaining:</Text>
                {completionSummary.remainingRequirements.map((r, i) => (
                  <Text key={`rr-${i}`} color="white">
                    {"  "}• {r}
                  </Text>
                ))}
              </Box>
            )}
        </Box>
      )}

      {/* Error Output */}
      {error && (
        <Box
          borderStyle="single"
          borderColor="red"
          paddingX={1}
          marginY={1}
          flexDirection="column"
        >
          <Text bold color="red">✗ Error: {error}</Text>
        </Box>
      )}
    </Box>
  );
};

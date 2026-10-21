import React from "react";
import { Box, Text } from "ink";
import { symbols } from "./symbols.js";
import { PlanView, type PlanStepItem } from "./PlanView.js";
import { getToolBadgeInfo } from "./toolBadgingUtils.js";

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
          <Text color="white" bold>{runId.slice(0, 16)}</Text>
          <Text color="gray"> {symbols.rule} Status: </Text>
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
            {status.toLowerCase()}
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

      {/* Active Tool Activity — compact single-line activity stream */}
      {activeTool && (
        <Box marginY={0} flexDirection="row">
          <Text color={getToolBadgeInfo(activeTool.toolName).color}>{symbols.dot} </Text>
          <Text bold color="white">{activeTool.toolName}</Text>
          {activeTool.target && (
            <Text color="cyan">({activeTool.target})</Text>
          )}
        </Box>
      )}

      {/* Active Verification Activity — compact borderless activity stream */}
      {activeVerification && (
        <Box marginY={0} flexDirection="row">
          <Text bold color="cyan">{symbols.verifying} </Text>
          <Text bold color="cyan">verifying: </Text>
          <Text bold color="white">{activeVerification.command}</Text>
          {activeVerification.attempt !== undefined && (
            <Text color="gray"> (attempt {activeVerification.attempt})</Text>
          )}
        </Box>
      )}

      {/* Active Recovery Activity — compact borderless activity stream */}
      {activeRecovery && (
        <Box marginY={0} flexDirection="row">
          <Text bold color="yellow">⟳ </Text>
          <Text bold color="yellow">recovery: </Text>
          <Text bold color="white">{activeRecovery.strategy}</Text>
        </Box>
      )}

      {/* Live Streamed Command / Process Output — borderless with left rail & collapsing */}
      {streamedOutput && (() => {
        const lines = streamedOutput.split(/\r?\n/);
        const maxLines = 15;
        const isCollapsed = lines.length > maxLines;
        const visibleLines = isCollapsed ? lines.slice(-maxLines) : lines;
        const hiddenCount = lines.length - maxLines;

        return (
          <Box
            marginY={1}
            flexDirection="column"
          >
            <Box marginBottom={0}>
              <Text color="gray" dimColor>
                {symbols.rule} Command Output {isCollapsed ? `(${hiddenCount} earlier lines collapsed) ` : ""}{symbols.rule}
              </Text>
            </Box>
            <Box flexDirection="row">
              <Text color="gray" dimColor>{symbols.rail} </Text>
              <Text color="white">{visibleLines.join("\n")}</Text>
            </Box>
          </Box>
        );
      })()}

      {/* Completion Summary — borderless inline summary */}
      {completionSummary && (
        <Box
          marginY={1}
          flexDirection="column"
        >
          <Box>
            <Text
              bold
              color={completionSummary.status === "completed" ? "green" : "red"}
            >
              {completionSummary.status === "completed"
                ? `${symbols.tick} Task complete`
                : `${symbols.warning} Task blocked`}
              {completionSummary.completedFiles && completionSummary.completedFiles.length > 0 && (
                <Text color="gray"> {symbols.rule} {completionSummary.completedFiles.length} file{completionSummary.completedFiles.length > 1 ? "s" : ""} changed</Text>
              )}
            </Text>
          </Box>
          {completionSummary.completedFiles &&
            completionSummary.completedFiles.length > 0 && (
              <Box flexDirection="column" marginTop={0}>
                {completionSummary.completedFiles.map((f, i) => (
                  <Text key={`cf-${i}`} color="gray">
                    {"  "}{symbols.bullet} <Text color="white">{f}</Text>
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
                    {"  "}{symbols.bullet} {c}
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
                    {"  "}{symbols.bullet} {r}
                  </Text>
                ))}
              </Box>
            )}
        </Box>
      )}

      {/* Error Output — clean borderless */}
      {error && (
        <Box
          marginY={1}
          flexDirection="column"
        >
          <Text bold color="red">{symbols.cross} Error: {error}</Text>
        </Box>
      )}
    </Box>
  );
};

import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export interface RecoveryStepItem {
  title: string;
  status: "pending" | "running" | "completed" | "failed";
}

export interface RecoveryViewProps {
  strategy?: string;
  steps?: RecoveryStepItem[];
  verificationStatus?: "PASSED" | "FAILED" | "PENDING" | string;
  workspaceStatus?: "CONSISTENT" | "INCONSISTENT" | string;
  outcome?: "RECOVERED" | "RECOVERED_WITH_CHANGES" | "STILL_BLOCKED" | "FAILED" | string;
  blockers?: string[];
  remainingStepsCount?: number;
  isAwaitingContinuation?: boolean;
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
}

export const RecoveryView: React.FC<RecoveryViewProps> = ({
  strategy = "checkpoint_restore",
  steps = [],
  verificationStatus,
  workspaceStatus,
  outcome,
  blockers = [],
  remainingStepsCount,
  isAwaitingContinuation = false,
  value,
  onChange,
  onSubmit
}) => {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={0}>
        <Text bold color="yellow">
          Recovery ({strategy})
        </Text>
      </Box>

      {/* Recovery Steps */}
      {steps.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          {steps.map((s, idx) => (
            <Box key={`rec-step-${idx}`}>
              <Text color={s.status === "completed" ? "green" : s.status === "failed" ? "red" : "yellow"}>
                {s.status === "completed" ? "✓" : s.status === "failed" ? "✗" : "●"}{" "}
              </Text>
              <Text color="white">{s.title}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Verification & Workspace status */}
      {verificationStatus && (
        <Box marginTop={0}>
          <Text color="gray">Verification: </Text>
          <Text color={verificationStatus === "PASSED" ? "green" : "red"} bold>
            {verificationStatus}
          </Text>
        </Box>
      )}

      {workspaceStatus && (
        <Box marginTop={0}>
          <Text color="gray">Workspace: </Text>
          <Text color={workspaceStatus === "CONSISTENT" ? "green" : "yellow"} bold>
            {workspaceStatus}
          </Text>
        </Box>
      )}

      {outcome && (
        <Box marginTop={0}>
          <Text color="gray">Outcome: </Text>
          <Text
            color={
              outcome === "RECOVERED" || outcome === "RECOVERED_WITH_CHANGES"
                ? "green"
                : "red"
            }
            bold
          >
            {outcome}
          </Text>
        </Box>
      )}

      {/* Initial Recovery Approval Prompt */}
      {!isAwaitingContinuation && outcome !== "STILL_BLOCKED" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">Proceed with recovery? [y/N]</Text>
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
      )}

      {/* Continuation Prompt or Blocked Options */}
      {isAwaitingContinuation && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">
            {remainingStepsCount !== undefined && remainingStepsCount > 0
              ? `Continue remaining ${remainingStepsCount} plan step(s)? [y/N]`
              : "Continue remaining plan steps? [y/N]"}
          </Text>
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
      )}

      {outcome === "STILL_BLOCKED" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">
            ⚠ Recovery could not fully resolve the problem.
          </Text>
          {blockers.length > 0 && (
            <Box flexDirection="column" marginTop={0}>
              <Text color="gray">Blockers:</Text>
              {blockers.map((b, i) => (
                <Text key={`rec-b-${i}`} color="red">
                  {"  "}• {b}
                </Text>
              ))}
            </Box>
          )}
          <Box flexDirection="column" marginTop={0}>
            <Text color="white">[r] Replan</Text>
            <Text color="white">[c] Re-check</Text>
            <Text color="white">[x] Cancel</Text>
          </Box>
          <Box marginTop={0}>
            <Text color="yellow" bold>Choice [x]: </Text>
            <TextInput
              value={value}
              onChange={onChange}
              onSubmit={onSubmit}
              placeholder="x"
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};

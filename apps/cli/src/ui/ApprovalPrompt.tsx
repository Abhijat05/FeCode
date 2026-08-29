import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export interface ChangeReviewItem {
  path: string;
  operation?: string;
  additions?: number;
  deletions?: number;
  diff?: string;
}

export interface ApprovalPromptProps {
  approvalType?:
    | "plan"
    | "step_checkpoint"
    | "tool_permission"
    | "recovery"
    | "continuation"
    | "replan"
    | string;
  title?: string;
  stepTitle?: string;
  stepOrder?: number;
  totalSteps?: number;
  toolName?: string;
  reason?: string;
  riskLevel?: string;
  affectedTargets?: string[];
  checkpointId?: string;
  diff?: string;
  changeReview?: {
    files?: ChangeReviewItem[];
    totalAddedLines?: number;
    totalRemovedLines?: number;
  };
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
}

export const ApprovalPrompt: React.FC<ApprovalPromptProps> = ({
  approvalType = "tool_permission",
  title,
  stepTitle,
  stepOrder,
  totalSteps,
  toolName,
  reason,
  riskLevel = "elevated",
  affectedTargets = [],
  checkpointId,
  diff,
  changeReview,
  value,
  onChange,
  onSubmit
}) => {
  const isFileEdit =
    toolName === "edit_file" ||
    toolName === "write_file" ||
    (changeReview?.files && changeReview.files.length > 0);

  const getHeaderTitle = () => {
    if (title) return title;
    if (isFileEdit) return "⚠ FeCode wants to modify a file";
    switch (approvalType) {
      case "plan":
        return "⚠ PLAN APPROVAL REQUIRED";
      case "step_checkpoint":
        return "⚠ STEP CHECKPOINT APPROVAL REQUIRED";
      case "recovery":
        return "⚠ RECOVERY APPROVAL REQUIRED";
      case "continuation":
        return "⚠ CONTINUATION APPROVAL REQUIRED";
      case "replan":
        return "⚠ REPLAN APPROVAL REQUIRED";
      case "tool_permission":
      default:
        return "⚠ FeCode wants to use a tool";
    }
  };

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
      borderStyle="double"
      borderColor="yellow"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={0}>
        <Text bold color="yellow">
          {getHeaderTitle()}
        </Text>
      </Box>

      {stepTitle && (
        <Box marginTop={0}>
          <Text color="gray">Step: </Text>
          <Text bold color="white">
            {stepOrder !== undefined && totalSteps !== undefined
              ? `[${stepOrder}/${totalSteps}] ${stepTitle}`
              : stepTitle}
          </Text>
        </Box>
      )}

      <Box marginTop={0} justifyContent="space-between">
        <Box>
          <Text color="gray">Risk: </Text>
          <Text bold color={getRiskColor(riskLevel)}>
            {riskLevel.toUpperCase()}
          </Text>
        </Box>
        <Box>
          <Text color="gray">Checkpoint: </Text>
          <Text color={checkpointId || riskLevel.toLowerCase() === "elevated" || riskLevel.toLowerCase() === "critical" ? "yellow" : "gray"}>
            {checkpointId ? `REQUIRED (${checkpointId.slice(0, 18)})` : "REQUIRED"}
          </Text>
        </Box>
      </Box>

      {toolName && (
        <Box marginTop={0}>
          <Text color="gray">Tool: </Text>
          <Text bold color="magenta">
            {toolName}
          </Text>
        </Box>
      )}

      {reason && (
        <Box marginTop={0}>
          <Text color="gray">Reason: </Text>
          <Text color="white">{reason}</Text>
        </Box>
      )}

      {affectedTargets.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="gray">Files / Resources:</Text>
          {affectedTargets.map((t, i) => (
            <Text key={`target-${i}`} color="cyan">
              {"  "}• {t}
            </Text>
          ))}
        </Box>
      )}

      {/* Structured Change Review */}
      {changeReview && changeReview.files && changeReview.files.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="gray">
            Change Review:
          </Text>
          {changeReview.files.map((cf, idx) => (
            <Box key={`cf-${idx}`} flexDirection="column" marginLeft={1}>
              <Box>
                <Text color="white">{cf.path}</Text>
                {cf.additions !== undefined && cf.deletions !== undefined && (
                  <Text color="gray">
                    {" "}
                    Change: +{cf.additions} -{cf.deletions}
                  </Text>
                )}
              </Box>
              {cf.diff && (
                <Box
                  borderStyle="single"
                  borderColor="gray"
                  paddingX={1}
                  marginY={0}
                  flexDirection="column"
                >
                  {cf.diff.split("\n").slice(0, 15).map((line, lIdx) => {
                    const isAdd = line.startsWith("+") && !line.startsWith("+++");
                    const isDel = line.startsWith("-") && !line.startsWith("---");
                    return (
                      <Text
                        key={`diff-${lIdx}`}
                        color={isAdd ? "green" : isDel ? "red" : "gray"}
                      >
                        {line}
                      </Text>
                    );
                  })}
                  {cf.diff.split("\n").length > 15 && (
                    <Text color="gray">
                      ... ({cf.diff.split("\n").length - 15} lines omitted)
                    </Text>
                  )}
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Direct Diff rendering if provided */}
      {diff && !changeReview && (
        <Box
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          marginY={1}
          flexDirection="column"
        >
          {diff.split("\n").slice(0, 15).map((line, lIdx) => {
            const isAdd = line.startsWith("+") && !line.startsWith("+++");
            const isDel = line.startsWith("-") && !line.startsWith("---");
            return (
              <Text
                key={`diff-raw-${lIdx}`}
                color={isAdd ? "green" : isDel ? "red" : "gray"}
              >
                {line}
              </Text>
            );
          })}
        </Box>
      )}

      {/* Approval Input Prompt with Strict Safe Defaults */}
      <Box marginTop={1}>
        <Text color="yellow" bold>
          Allow? [y/N]:{" "}
        </Text>
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

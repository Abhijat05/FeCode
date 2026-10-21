import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { getToolBadgeInfo } from "./toolBadgingUtils.js";

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
  value?: string;
  onChange?: (val: string) => void;
  onSubmit: (val: string) => void;
  defaultIndex?: number;
  isScrolled?: boolean;
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
  value: _value,
  onChange: _onChange,
  onSubmit,
  defaultIndex,
  isScrolled = false
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(defaultIndex ?? 1);
  const [diffOffset, setDiffOffset] = useState<number>(0);

  const primaryDiff =
    changeReview?.files?.find((f) => f.diff)?.diff || diff || "";
  const diffLines = React.useMemo(
    () => (primaryDiff ? primaryDiff.split(/\r?\n/) : []),
    [primaryDiff]
  );
  const maxDiffVisible = 15;
  const maxDiffOffset = Math.max(0, diffLines.length - maxDiffVisible);

  useInput(
    (input, key) => {
      // Let mouse wheel, PageUp/PageDown, and Shift+Arrows pass through for history scrolling
      if (
        key.pageUp ||
        key.pageDown ||
        (key.shift && (key.upArrow || key.downArrow)) ||
        (key.ctrl && (input === "u" || input === "d")) ||
        input.includes("<64;") ||
        input.includes("<65;") ||
        input.startsWith("[<64;") ||
        input.startsWith("[<65;")
      ) {
        return;
      }

      // If user is scrolled up viewing history, let Escape return to bottom without denying prompt
      if (key.escape && isScrolled) {
        return;
      }

      // Diff scrolling via [ / ] or up / down when diff has overflow
      if ((input === "[" || (key.upArrow && maxDiffOffset > 0)) && maxDiffOffset > 0) {
        setDiffOffset((prev) => Math.max(0, prev - 1));
        return;
      }
      if ((input === "]" || (key.downArrow && maxDiffOffset > 0)) && maxDiffOffset > 0) {
        setDiffOffset((prev) => Math.min(maxDiffOffset, prev + 1));
        return;
      }

      if (
        key.leftArrow ||
        key.rightArrow ||
        key.tab ||
        ((key.upArrow || key.downArrow) && maxDiffOffset === 0)
      ) {
        setSelectedIndex((prev) => (prev === 0 ? 1 : 0));
        return;
      }

      if (key.return) {
        onSubmit(selectedIndex === 0 ? "y" : "n");
        return;
      }

      if (input === "y" || input === "Y") {
        setSelectedIndex(0);
        onSubmit("y");
        return;
      }

      if (input === "n" || input === "N" || key.escape) {
        setSelectedIndex(1);
        onSubmit("n");
        return;
      }
    },
    { isActive: true }
  );

  const isFileEdit =
    toolName === "edit_file" ||
    toolName === "write_file" ||
    (changeReview?.files && changeReview.files.length > 0);

  const getHeaderTitle = () => {
    if (title) return title;
    if (isFileEdit) return "⚠ FeCode wants to modify a file";
    switch (approvalType) {
      case "plan":
        return "⚠ Plan approval required";
      case "step_checkpoint":
        return "⚠ Step checkpoint approval required";
      case "recovery":
        return "⚠ Recovery approval required";
      case "continuation":
        return "⚠ Continuation approval required";
      case "replan":
        return "⚠ Replan approval required";
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
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={0} justifyContent="space-between">
        <Text bold color="yellow">
          {getHeaderTitle()}
        </Text>
        <Box>
          <Text color="gray">Risk: </Text>
          <Text bold color={getRiskColor(riskLevel)}>
            {riskLevel.toLowerCase()}
          </Text>
        </Box>
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

      {(checkpointId || riskLevel.toLowerCase() === "elevated" || riskLevel.toLowerCase() === "critical") && (
        <Box marginTop={0}>
          <Text color="gray">Checkpoint: </Text>
          <Text color="yellow">required</Text>
        </Box>
      )}

      {toolName && (
        <Box marginTop={0}>
          <Text color="gray">Tool: </Text>
          <Text bold color={getToolBadgeInfo(toolName).color}>
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
                  {cf.diff.split(/\r?\n/).slice(diffOffset, diffOffset + maxDiffVisible).map((line, lIdx) => {
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
                  {maxDiffOffset > 0 && (
                    <Box marginTop={0} justifyContent="space-between">
                      <Text color="gray">
                        {diffOffset > 0 ? `▲ ... ${diffOffset} earlier lines` : " "}
                      </Text>
                      <Text color="cyan" dimColor>
                        Lines {diffOffset + 1}–{Math.min(diffLines.length, diffOffset + maxDiffVisible)} of {diffLines.length} [↑/↓ or [/] to scroll]
                      </Text>
                      <Text color="gray">
                        {diffOffset + maxDiffVisible < diffLines.length
                          ? `▼ ... ${diffLines.length - (diffOffset + maxDiffVisible)} more lines`
                          : " "}
                      </Text>
                    </Box>
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
          {diffLines.slice(diffOffset, diffOffset + maxDiffVisible).map((line, lIdx) => {
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
          {maxDiffOffset > 0 && (
            <Box marginTop={0} justifyContent="space-between">
              <Text color="gray">
                {diffOffset > 0 ? `▲ ... ${diffOffset} earlier lines` : " "}
              </Text>
              <Text color="cyan" dimColor>
                Lines {diffOffset + 1}–{Math.min(diffLines.length, diffOffset + maxDiffVisible)} of {diffLines.length} [↑/↓ or [/] to scroll]
              </Text>
              <Text color="gray">
                {diffOffset + maxDiffVisible < diffLines.length
                  ? `▼ ... ${diffLines.length - (diffOffset + maxDiffVisible)} more lines`
                  : " "}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Approval Selection Prompt with Interactive Arrow Navigation */}
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color="yellow" bold>
            Allow? [y/N]:{" "}
          </Text>
          <Box marginLeft={1}>
            <Text
              color={selectedIndex === 0 ? "green" : "gray"}
              bold={selectedIndex === 0}
            >
              {selectedIndex === 0 ? "● Yes (Approve)" : "○ Yes (Approve)"}
            </Text>
            <Text>   </Text>
            <Text
              color={selectedIndex === 1 ? "red" : "gray"}
              bold={selectedIndex === 1}
            >
              {selectedIndex === 1 ? "● No (Deny)" : "○ No (Deny)"}
            </Text>
          </Box>
        </Box>
        <Box marginTop={0}>
          <Text color="gray" dimColor>
            (Use ←/→ or Tab to select, Enter to confirm, or press y/n)
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

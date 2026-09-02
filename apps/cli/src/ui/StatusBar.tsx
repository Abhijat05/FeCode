import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

export interface StatusBarProps {
  status?: string;
  activeStep?: number;
  totalSteps?: number;
  activeStepTitle?: string;
  isGenerating?: boolean;
  hasModal?: boolean;
  modalType?: "approval" | "blocked" | "recovery" | "replan" | "resume" | string;
  customMessage?: string;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

const ACTIVE_STATUSES = new Set([
  "executing",
  "planning",
  "verifying",
  "recovering"
]);

export const StatusBar: React.FC<StatusBarProps> = ({
  status = "idle",
  activeStep,
  totalSteps,
  activeStepTitle,
  isGenerating = false,
  hasModal = false,
  modalType,
  customMessage
}) => {
  const [frame, setFrame] = useState(0);
  const isAnimating = isGenerating || ACTIVE_STATUSES.has(status.toLowerCase());

  useEffect(() => {
    if (!isAnimating) return;
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isAnimating]);

  const spinner = isAnimating ? `${SPINNER_FRAMES[frame]} ` : "";

  const renderStatusText = () => {
    if (customMessage) {
      return (
        <Text color="yellow">
          {spinner}
          {customMessage}
        </Text>
      );
    }

    if (activeStep !== undefined && totalSteps !== undefined && totalSteps > 0) {
      const stepText = `Step ${activeStep}/${totalSteps}${activeStepTitle ? `: ${activeStepTitle}` : ""}`;
      if (status === "executing" || isGenerating) {
        return (
          <Text color="green">
            {spinner}Executing {stepText}
          </Text>
        );
      }
      if (status === "awaiting_step_approval") {
        return <Text color="yellow">⚠ Waiting for Approval ({stepText})</Text>;
      }
      if (status === "verifying") {
        return (
          <Text color="cyan">
            {spinner}Verifying ({stepText})
          </Text>
        );
      }
      if (status === "blocked") {
        return <Text color="red">! Blocked at {stepText}</Text>;
      }
    }

    switch (status.toLowerCase()) {
      case "in_progress":
      case "generating":
      case "executing":
      case "running":
        return <Text color="green">{spinner}Executing task...</Text>;
      case "planning":
        return <Text color="cyan">{spinner}Generating task plan...</Text>;
      case "awaiting_plan_approval":
        return <Text color="yellow">⚠ Plan approval required</Text>;
      case "awaiting_step_approval":
        return <Text color="yellow">⚠ Step approval required</Text>;
      case "verifying":
        return <Text color="cyan">{spinner}Verifying changes...</Text>;
      case "recovering":
        return <Text color="yellow">{spinner}Performing recovery...</Text>;
      case "blocked":
        return <Text color="red">! Plan execution blocked</Text>;
      case "completed":
        return <Text color="green">✓ Task completed</Text>;
      case "failed":
        return <Text color="red">✗ Task failed</Text>;
      case "cancelled":
        return <Text color="gray">⊘ Task cancelled</Text>;
      case "idle":
      default:
        return <Text color="gray">○ Ready for task</Text>;
    }
  };

  const renderShortcuts = () => {
    if (hasModal) {
      if (modalType === "approval") {
        return (
          <Box>
            <Text color="yellow">[y]</Text>
            <Text color="gray"> Approve </Text>
            <Text color="yellow">[n]</Text>
            <Text color="gray"> Reject </Text>
            <Text color="gray">[Esc] Cancel</Text>
          </Box>
        );
      }
      if (modalType === "blocked") {
        return (
          <Box>
            <Text color="green">[c]</Text>
            <Text color="gray"> Continue </Text>
            <Text color="cyan">[r]</Text>
            <Text color="gray"> Replan </Text>
            <Text color="gray">[x] Cancel</Text>
          </Box>
        );
      }
      if (modalType === "recovery") {
        return (
          <Box>
            <Text color="green">[c]</Text>
            <Text color="gray"> Continue </Text>
            <Text color="cyan">[r]</Text>
            <Text color="gray"> Replan </Text>
            <Text color="yellow">[v]</Text>
            <Text color="gray"> Re-check </Text>
            <Text color="gray">[x] Cancel</Text>
          </Box>
        );
      }
      return (
        <Box>
          <Text color="yellow">[y]</Text>
          <Text color="gray"> Yes </Text>
          <Text color="yellow">[n]</Text>
          <Text color="gray"> No </Text>
          <Text color="gray">[Esc] Cancel</Text>
        </Box>
      );
    }

    return (
      <Box>
        <Text color="cyan">[c]</Text>
        <Text color="gray"> Cancel </Text>
        <Text color="cyan">[p]</Text>
        <Text color="gray"> Plan </Text>
        <Text color="cyan">[r]</Text>
        <Text color="gray"> Runs </Text>
        <Text color="cyan">[d]</Text>
        <Text color="gray"> Diagnostics </Text>
        <Text color="cyan">[?]</Text>
        <Text color="gray"> Help</Text>
      </Box>
    );
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
    >
      <Box justifyContent="space-between">
        <Box>{renderStatusText()}</Box>
        <Box>{renderShortcuts()}</Box>
      </Box>
    </Box>
  );
};

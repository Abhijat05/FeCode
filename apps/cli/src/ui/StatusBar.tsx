import React from "react";
import { Box, Text, useStdout } from "ink";
import { getTerminalLayout, truncateText } from "./AppShell.js";
import { useGlobalSpinner } from "./spinnerUtils.js";

export interface StatusBarProps {
  status?: string;
  activeStep?: number;
  totalSteps?: number;
  activeStepTitle?: string;
  isGenerating?: boolean;
  hasModal?: boolean;
  isScrolled?: boolean;
  modalType?: "approval" | "blocked" | "recovery" | "replan" | "resume" | string;
  customMessage?: string;
  isReconciliation?: boolean;
  recoveryMode?: "confirm" | "continuation" | "still_blocked" | string;
  activeView?: string;
  columns?: number;
  exitPending?: boolean;
}

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
  isScrolled = false,
  modalType,
  customMessage,
  isReconciliation = false,
  recoveryMode = "confirm",
  activeView = "main",
  columns: explicitColumns,
  exitPending = false
}) => {
  const { stdout } = useStdout();
  const terminalColumns = explicitColumns ?? stdout?.columns ?? 80;
  const layout = getTerminalLayout(terminalColumns);

  const isAnimating =
    !hasModal &&
    !isScrolled &&
    (isGenerating || ACTIVE_STATUSES.has(status.toLowerCase()));

  const spinnerGlyph = useGlobalSpinner(isAnimating);
  const spinner = isAnimating && spinnerGlyph ? `${spinnerGlyph} ` : isAnimating ? "⠋ " : "";

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
      const maxTitleLen = layout === "wide" ? 40 : layout === "medium" ? 25 : 15;
      const displayTitle = activeStepTitle ? `: ${truncateText(activeStepTitle, maxTitleLen)}` : "";
      const stepText = `Step ${activeStep}/${totalSteps}${displayTitle}`;
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
    if (exitPending) {
      return (
        <Box>
          <Text color="yellow" bold>
            Press Ctrl+C again to exit
          </Text>
        </Box>
      );
    }

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
        if (isReconciliation) {
          return (
            <Box>
              <Text color="yellow">[r]</Text>
              <Text color="gray"> Recover </Text>
              <Text color="cyan">[p]</Text>
              <Text color="gray"> Replan </Text>
              <Text color="gray">[x] Cancel</Text>
            </Box>
          );
        }
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
        if (recoveryMode === "still_blocked") {
          return (
            <Box>
              <Text color="cyan">[r]</Text>
              <Text color="gray"> Replan </Text>
              <Text color="green">[c]</Text>
              <Text color="gray"> Re-check </Text>
              <Text color="gray">[x] Cancel</Text>
            </Box>
          );
        }
        if (recoveryMode === "continuation") {
          return (
            <Box>
              <Text color="green">[y]</Text>
              <Text color="gray"> Continue </Text>
              <Text color="yellow">[n]</Text>
              <Text color="gray"> Cancel </Text>
              <Text color="gray">[Esc] Cancel</Text>
            </Box>
          );
        }
        return (
          <Box>
            <Text color="green">[y]</Text>
            <Text color="gray"> Proceed </Text>
            <Text color="yellow">[n]</Text>
            <Text color="gray"> Cancel </Text>
            <Text color="gray">[Esc] Cancel</Text>
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

    if (activeView && activeView !== "main") {
      if (layout === "very_narrow") {
        return (
          <Box>
            <Text color="gray">
              <Text color="cyan">esc</Text> main
            </Text>
          </Box>
        );
      }
      if (layout === "narrow") {
        return (
          <Box>
            <Text color="gray">
              <Text color="cyan">esc</Text> main · <Text color="cyan">?</Text> help
            </Text>
          </Box>
        );
      }
      return (
        <Box>
          <Text color="gray">
            <Text color="cyan">esc</Text> main · <Text color="cyan">p</Text> plan · <Text color="cyan">r</Text> runs · <Text color="cyan">d</Text> diagnostics · <Text color="cyan">?</Text> help
          </Text>
        </Box>
      );
    }

    if (isGenerating || ACTIVE_STATUSES.has(status.toLowerCase())) {
      return (
        <Box>
          <Text color="gray">
            <Text color="cyan">ctrl+c</Text> cancel
          </Text>
        </Box>
      );
    }

    if (layout === "wide") {
      return (
        <Box>
          <Text color="gray">
            <Text color="cyan">ctrl+c</Text> exit · <Text color="cyan">/plan</Text> · <Text color="cyan">/runs</Text> · <Text color="cyan">/debug</Text> · <Text color="cyan">?</Text> help
          </Text>
        </Box>
      );
    }

    if (layout === "medium") {
      return (
        <Box>
          <Text color="gray">
            <Text color="cyan">ctrl+c</Text> exit · <Text color="cyan">/plan</Text> · <Text color="cyan">/runs</Text> · <Text color="cyan">/debug</Text> · <Text color="cyan">?</Text> help
          </Text>
        </Box>
      );
    }

    if (layout === "narrow") {
      return (
        <Box>
          <Text color="gray">
            <Text color="cyan">ctrl+c</Text> exit · <Text color="cyan">?</Text> help
          </Text>
        </Box>
      );
    }

    return (
      <Box>
        <Text color="gray">
          <Text color="cyan">ctrl+c</Text> exit
        </Text>
      </Box>
    );
  };

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      width="100%"
      marginTop={0}
      marginBottom={0}
    >
      <Box flexShrink={1}>{renderStatusText()}</Box>
      <Box flexShrink={0}>{renderShortcuts()}</Box>
    </Box>
  );
};

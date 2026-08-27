import React from "react";
import { Box, Text } from "ink";

export interface DiagnosticsViewProps {
  summary?: {
    runId: string;
    startedAt: number;
    completedAt?: number;
    durationMs?: number;
    finalStatus?: string;
    cwd?: string;
    userRequestSummary?: string;
    activeSkills?: string[];
    initialRiskLevel?: string;
    riskReasons?: string[];
    requiresCheckpoint?: boolean;
    requiresExplicitApproval?: boolean;
    verificationAttempts?: number;
    maxVerificationAttempts?: number;
    recoveryAttempts?: number;
    maxRecoveryAttempts?: number;
    tools?: Array<{ toolName: string; count?: number; calls?: number }>;
    commands?: Array<{ command: string; exitCode?: number | null }>;
    files?: { modified?: string[]; created?: string[]; deleted?: string[] };
    lifecycleTransitions?: Array<{ from: string; to: string; reason: string }>;
  };
  formattedOutput?: string;
}

export const DiagnosticsView: React.FC<DiagnosticsViewProps> = ({
  summary,
  formattedOutput
}) => {
  if (formattedOutput) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="magenta"
        paddingX={1}
        marginY={1}
      >
        <Box marginBottom={0}>
          <Text bold color="magenta">Diagnostics & Debug Info</Text>
        </Box>
        <Text color="white">{formattedOutput}</Text>
      </Box>
    );
  }

  if (!summary) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        marginY={1}
      >
        <Text color="gray">No diagnostic information available for current run.</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="magenta"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={0}>
        <Text bold color="magenta">Diagnostics: </Text>
        <Text bold color="white">Run: {summary.runId}</Text>
      </Box>

      <Box marginTop={0}>
        <Text color="gray">Status: </Text>
        <Text
          bold
          color={
            summary.finalStatus === "completed"
              ? "green"
              : summary.finalStatus === "failed"
                ? "red"
                : "yellow"
          }
        >
          {summary.finalStatus || "running"}
        </Text>
        {summary.durationMs !== undefined && (
          <Text color="gray"> | Duration: {Math.round(summary.durationMs / 1000)}s</Text>
        )}
      </Box>

      {summary.userRequestSummary && (
        <Box marginTop={0}>
          <Text color="gray">Request: </Text>
          <Text color="white">
            {summary.userRequestSummary
              .replace(/(?:sk-|key-|AIza)[a-zA-Z0-9_-]{8,}/g, "[REDACTED]")
              .replace(
                /(?:api[_-]?key|secret|token)[\s:=]+([a-zA-Z0-9_.-]+)/gi,
                "[REDACTED]"
              )}
          </Text>
        </Box>
      )}

      {summary.initialRiskLevel && (
        <Box marginTop={0}>
          <Text color="gray">Initial Risk: </Text>
          <Text color="yellow">{summary.initialRiskLevel.toUpperCase()}</Text>
        </Box>
      )}

      {summary.activeSkills && summary.activeSkills.length > 0 && (
        <Box marginTop={0}>
          <Text color="gray">Active Skills: </Text>
          <Text color="cyan">{summary.activeSkills.join(", ")}</Text>
        </Box>
      )}

      {summary.verificationAttempts !== undefined && (
        <Box marginTop={0}>
          <Text color="gray">Verification Attempts: </Text>
          <Text color="white">
            {summary.verificationAttempts}/{summary.maxVerificationAttempts || 3}
          </Text>
        </Box>
      )}

      {summary.recoveryAttempts !== undefined && (
        <Box marginTop={0}>
          <Text color="gray">Recovery Attempts: </Text>
          <Text color="white">
            {summary.recoveryAttempts}/{summary.maxRecoveryAttempts || 1}
          </Text>
        </Box>
      )}

      {summary.tools && summary.tools.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="gray">Tool Invocations:</Text>
          {summary.tools.map((t, idx) => (
            <Text key={`diag-tool-${idx}`} color="white">
              {"  "}• {t.toolName} ({t.count || t.calls || 1})
            </Text>
          ))}
        </Box>
      )}

      {summary.files && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="gray">File Operations:</Text>
          {summary.files.modified && summary.files.modified.length > 0 && (
            <Text color="white">
              {"  "}• Modified: {summary.files.modified.join(", ")}
            </Text>
          )}
          {summary.files.created && summary.files.created.length > 0 && (
            <Text color="white">
              {"  "}• Created: {summary.files.created.join(", ")}
            </Text>
          )}
          {summary.files.deleted && summary.files.deleted.length > 0 && (
            <Text color="white">
              {"  "}• Deleted: {summary.files.deleted.join(", ")}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};

import React from "react";
import { Box, Text } from "ink";

export interface RiskNoticeProps {
  level?: "low" | "normal" | "elevated" | "high" | "critical" | string;
  reasons?: string[];
  requiresCheckpoint?: boolean;
  requiresExplicitApproval?: boolean;
  affectedFilesCount?: number;
}

export const RiskNotice: React.FC<RiskNoticeProps> = ({
  level = "normal",
  reasons = [],
  requiresCheckpoint,
  requiresExplicitApproval,
  affectedFilesCount
}) => {
  const normLevel = level.toLowerCase();

  const getBorderColor = () => {
    switch (normLevel) {
      case "critical":
        return "red";
      case "high":
      case "elevated":
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
      borderStyle="single"
      borderColor={getBorderColor()}
      paddingX={1}
      marginY={1}
    >
      <Box>
        <Text bold color={getBorderColor()}>
          Risk: {level.toUpperCase()}
        </Text>
      </Box>

      {reasons.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="gray">Reasons:</Text>
          {reasons.map((r, i) => (
            <Text key={`reason-${i}`} color="white">
              {"  "}• {r}
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={0}>
        {requiresCheckpoint !== undefined && (
          <Text color="gray">
            Checkpoint:{" "}
            <Text color={requiresCheckpoint ? "yellow" : "green"}>
              {requiresCheckpoint ? "REQUIRED" : "NOT REQUIRED"}
            </Text>
            {"  "}
          </Text>
        )}
        {requiresExplicitApproval !== undefined && (
          <Text color="gray">
            Approval:{" "}
            <Text color={requiresExplicitApproval ? "yellow" : "green"}>
              {requiresExplicitApproval ? "REQUIRED" : "AUTOMATIC"}
            </Text>
          </Text>
        )}
        {affectedFilesCount !== undefined && affectedFilesCount > 0 && (
          <Text color="gray"> (Files affected: {affectedFilesCount})</Text>
        )}
      </Box>
    </Box>
  );
};

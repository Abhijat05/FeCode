import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export interface ReplanViewProps {
  originalPlanId?: string;
  newPlanId?: string;
  reason?: string;
  replanDepth?: number;
  workspaceChanges?: string[];
  riskLevel?: string;
  lineage?: string[];
  newPlanSummary?: string;
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
}

export const ReplanView: React.FC<ReplanViewProps> = ({
  originalPlanId,
  newPlanId,
  reason = "Workspace changed after plan approval.",
  replanDepth = 1,
  workspaceChanges = [],
  riskLevel = "normal",
  lineage = [],
  newPlanSummary,
  value,
  onChange,
  onSubmit
}) => {
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
          REPLAN REQUIRED
        </Text>
      </Box>

      <Box marginTop={0} flexDirection="column">
        <Text color="gray">Reason:</Text>
        <Text color="white">{reason}</Text>
      </Box>

      {originalPlanId && (
        <Box marginTop={0}>
          <Text color="gray">Original: </Text>
          <Text color="white">{originalPlanId}</Text>
        </Box>
      )}

      {newPlanId && (
        <Box marginTop={0}>
          <Text color="gray">New: </Text>
          <Text color="cyan">{newPlanId}</Text>
        </Box>
      )}

      {originalPlanId && (
        <Box marginTop={0}>
          <Text color="gray">Parent: </Text>
          <Text color="white">{originalPlanId}</Text>
        </Box>
      )}

      <Box marginTop={0}>
        <Text color="gray">Replan depth: </Text>
        <Text color="white">{replanDepth}</Text>
      </Box>

      {riskLevel && (
        <Box marginTop={0}>
          <Text color="gray">Risk reassessment: </Text>
          <Text color="yellow" bold>{riskLevel.toUpperCase()}</Text>
        </Box>
      )}

      {workspaceChanges.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="gray">Workspace changes:</Text>
          {workspaceChanges.map((c, i) => (
            <Text key={`replan-c-${i}`} color="yellow">
              {"  "}⚠ {c}
            </Text>
          ))}
        </Box>
      )}

      {newPlanSummary && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="gray">Replacement plan preview:</Text>
          <Text color="white">{newPlanSummary}</Text>
        </Box>
      )}

      {lineage.length > 0 && (
        <Box marginTop={0}>
          <Text color="gray">Lineage: </Text>
          <Text color="gray">{lineage.join(" -> ")}</Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          (Note: Creating a replacement plan does NOT automatically execute it.)
        </Text>
        <Text color="yellow">Create this replacement plan? [y/N]</Text>
      </Box>

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
  );
};

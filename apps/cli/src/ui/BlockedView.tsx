import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export interface BlockedViewProps {
  planId?: string;
  stepInfo?: string;
  reason?: string;
  affectedSteps?: string[];
  isReconciliation?: boolean;
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
}

export const BlockedView: React.FC<BlockedViewProps> = ({
  planId,
  stepInfo,
  reason = "Workspace changed since approval.",
  affectedSteps = [],
  isReconciliation = false,
  value,
  onChange,
  onSubmit
}) => {
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="red"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={0}>
        <Text bold color="red">
          ⚠ PLAN EXECUTION BLOCKED
        </Text>
      </Box>

      {planId && (
        <Box marginTop={0}>
          <Text color="gray">Plan: </Text>
          <Text color="white" bold>
            {planId}
          </Text>
        </Box>
      )}

      {stepInfo && (
        <Box marginTop={0}>
          <Text color="gray">Step: </Text>
          <Text color="white">{stepInfo}</Text>
        </Box>
      )}

      <Box marginTop={0} flexDirection="column">
        <Text color="gray">Reason:</Text>
        <Text color="red">{reason}</Text>
      </Box>

      {affectedSteps.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="gray">Affected steps:</Text>
          {affectedSteps.map((s, i) => (
            <Text key={`aff-${i}`} color="white">
              {"  "}• {s}
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">What action would you like to take?</Text>
        {isReconciliation ? (
          <Box flexDirection="row" marginY={0}>
            <Text bold color="yellow">
              [r]
            </Text>
            <Text color="white"> Recover from checkpoint  </Text>
            <Text bold color="cyan">
              [p]
            </Text>
            <Text color="white"> Replan  </Text>
            <Text bold color="gray">
              [x]
            </Text>
            <Text color="white"> Cancel (Default)</Text>
          </Box>
        ) : (
          <Box flexDirection="row" marginY={0}>
            <Text bold color="green">
              [c]
            </Text>
            <Text color="white"> Continue  </Text>
            <Text bold color="cyan">
              [r]
            </Text>
            <Text color="white"> Replan  </Text>
            <Text bold color="gray">
              [x]
            </Text>
            <Text color="white"> Cancel (Default)</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={0}>
        <Text color="yellow" bold>
          Choice [x]:{" "}
        </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder="x"
        />
      </Box>
    </Box>
  );
};

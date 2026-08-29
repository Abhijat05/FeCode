import React from "react";
import { Box, Text } from "ink";

export interface ProgressBarProps {
  completed: number;
  total: number;
  width?: number;
  showFraction?: boolean;
  showPercentage?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  completed,
  total,
  width = 20,
  showFraction = true,
  showPercentage = true
}) => {
  const safeTotal = Math.max(total, 1);
  const safeCompleted = Math.min(Math.max(completed, 0), safeTotal);
  const fraction = safeCompleted / safeTotal;
  const percentage = Math.round(fraction * 100);

  const filledCount = Math.round(fraction * width);
  const emptyCount = Math.max(0, width - filledCount);

  const filledBar = "█".repeat(filledCount);
  const emptyBar = "░".repeat(emptyCount);

  return (
    <Box flexDirection="row" alignItems="center">
      <Text color="cyan">[</Text>
      <Text color="green">{filledBar}</Text>
      <Text color="gray">{emptyBar}</Text>
      <Text color="cyan">]</Text>
      {showPercentage && <Text color="white"> {percentage}%</Text>}
      {showFraction && (
        <Text color="gray">
          {" "}
          ({safeCompleted}/{safeTotal} steps)
        </Text>
      )}
    </Box>
  );
};

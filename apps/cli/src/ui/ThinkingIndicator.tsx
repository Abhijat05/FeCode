import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

export interface ThinkingIndicatorProps {
  isActive: boolean;
  label?: string;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  isActive,
  label = "Working..."
}) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isActive]);

  if (!isActive) return null;

  return (
    <Box>
      <Text color="cyan">{SPINNER_FRAMES[frame]} </Text>
      <Text color="cyan">{label}</Text>
    </Box>
  );
};

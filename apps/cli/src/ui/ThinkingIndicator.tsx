import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

export interface ThinkingIndicatorProps {
  isActive: boolean;
  isScrolled?: boolean;
  label?: string;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 300;

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  isActive,
  isScrolled = false,
  label = "Working..."
}) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isActive || isScrolled) return;
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isActive, isScrolled]);

  if (!isActive || isScrolled) return null;

  return (
    <Box height={1}>
      <Text color="cyan">{SPINNER_FRAMES[frame]} </Text>
      <Text color="cyan" wrap="truncate-end">{label}</Text>
    </Box>
  );
};

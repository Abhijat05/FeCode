import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

export interface ThinkingIndicatorProps {
  isActive: boolean;
  isScrolled?: boolean;
  label?: string;
  elapsedMs?: number;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 300;

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  isActive,
  isScrolled = false,
  label = "Working...",
  elapsedMs
}) => {
  const [frame, setFrame] = useState(0);
  const [internalElapsedMs, setInternalElapsedMs] = useState(0);

  useEffect(() => {
    if (!isActive || isScrolled) {
      setFrame(0);
      setInternalElapsedMs(0);
      return;
    }
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isActive, isScrolled]);

  useEffect(() => {
    if (!isActive || isScrolled || elapsedMs !== undefined) {
      if (!isActive || isScrolled) setInternalElapsedMs(0);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      setInternalElapsedMs(Date.now() - start);
    }, 1000);
    return () => clearInterval(timer);
  }, [isActive, isScrolled, elapsedMs]);

  if (!isActive || isScrolled) return null;

  const currentElapsed = elapsedMs !== undefined ? elapsedMs : internalElapsedMs;
  const elapsedSec = currentElapsed >= 1000 ? Math.floor(currentElapsed / 1000) : null;
  const elapsedSuffix = elapsedSec !== null ? ` (${elapsedSec}s)` : "";

  return (
    <Box height={1}>
      <Text color="cyan">{SPINNER_FRAMES[frame]} </Text>
      <Text color="cyan" wrap="truncate-end">
        {label}{elapsedSuffix}
      </Text>
    </Box>
  );
};

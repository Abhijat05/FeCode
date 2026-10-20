import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useGlobalSpinner } from "./spinnerUtils.js";

export interface ThinkingIndicatorProps {
  isActive: boolean;
  isScrolled?: boolean;
  label?: string;
  elapsedMs?: number;
  tokenCount?: number;
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  isActive,
  isScrolled = false,
  label = "Working...",
  elapsedMs,
  tokenCount
}) => {
  const isAnimating = isActive && !isScrolled;
  const spinnerGlyph = useGlobalSpinner(isAnimating);
  const [internalElapsedMs, setInternalElapsedMs] = useState(0);

  useEffect(() => {
    if (!isAnimating || elapsedMs !== undefined) {
      if (!isAnimating) setInternalElapsedMs(0);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      setInternalElapsedMs(Date.now() - start);
    }, 1000);
    return () => clearInterval(timer);
  }, [isAnimating, elapsedMs]);

  if (!isAnimating) return null;

  const currentElapsed = elapsedMs !== undefined ? elapsedMs : internalElapsedMs;
  const elapsedSec = currentElapsed >= 1000 ? Math.floor(currentElapsed / 1000) : null;
  const elapsedPart = elapsedSec !== null ? `${elapsedSec}s` : "";
  const tokenPart = tokenCount !== undefined && tokenCount > 0 ? `${tokenCount} tokens` : "";
  const metrics = [elapsedPart, tokenPart].filter(Boolean).join(" · ");
  const metricsSuffix = metrics ? ` (${metrics})` : "";

  return (
    <Box height={1}>
      <Text color="cyan">{spinnerGlyph || "⠋"} </Text>
      <Text color="cyan" wrap="truncate-end">
        {label}{metricsSuffix}
      </Text>
    </Box>
  );
};

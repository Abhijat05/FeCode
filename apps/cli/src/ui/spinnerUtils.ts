import { useState, useEffect } from "react";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const SPINNER_INTERVAL_MS = 300;

/**
 * Returns the deterministic braille spinner frame for a given epoch millisecond timestamp.
 * Guarantees that independent components animate in identical lockstep.
 */
export function getGlobalSpinnerFrame(now: number = Date.now()): string {
  const frameIndex = Math.floor(now / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[frameIndex];
}

/**
 * React hook that returns the synchronized global spinner frame string,
 * automatically updating on intervals while active.
 */
export function useGlobalSpinner(isActive: boolean): string {
  const [frame, setFrame] = useState(() => (isActive ? getGlobalSpinnerFrame() : ""));

  useEffect(() => {
    if (!isActive) return;
    setFrame(getGlobalSpinnerFrame());
    const timer = setInterval(() => {
      setFrame(getGlobalSpinnerFrame());
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isActive]);

  return isActive ? frame : "";
}

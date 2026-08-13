import type { Skill } from "../types.js";

export const frontendDebuggingSkill: Skill = {
  name: "frontend-debugging",
  description: "Root-cause analysis, state tracing, and minimal targeted UI bug fixes.",
  category: "frontend",
  version: "2.0.0",
  activation: {
    when: ["debugging UI failures", "fixing runtime errors", "resolving CSS layout defects"]
  },
  instructions: [
    "Inspect full error tracebacks and console messages before attempting code modifications.",
    "Trace component props, state propagation, and event handler parameters to identify root causes.",
    "Distinguish between layout/CSS defects and data/state flow bugs."
  ],
  workflow: [
    "1. Fetch and inspect exact un-truncated error logs and stack traces.",
    "2. Trace upstream data providers and component prop propagation.",
    "3. Apply a minimal targeted edit and verify runtime behavior."
  ],
  rules: [
    "Never mask symptoms, swallow exceptions, or delete failing tests.",
    "Gather empirical runtime verification before declaring bug resolution."
  ],
  antiPatterns: [
    "Avoid superficial symptom patches like empty try/catch blocks.",
    "Avoid retrying duplicate broken test or build commands without diagnostic analysis."
  ]
};

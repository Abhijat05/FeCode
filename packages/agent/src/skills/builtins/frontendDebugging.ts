import type { Skill } from "../types.js";

export const frontendDebuggingSkill: Skill = {
  name: "frontend-debugging",
  description: "Root-cause analysis, state tracing, and minimal targeted UI bug fixes.",
  category: "frontend",
  version: "1.0.0",
  instructions: `### Skill: Systematic Frontend Debugging
- Inspect full error tracebacks and console messages before attempting code modifications.
- Trace component props, state propagation, and event handler parameters to identify root causes.
- Distinguish between layout/CSS defects and data/state flow bugs.
- Make minimal, targeted edits rather than sweeping structural rewrites.
- Verify fixes using available test or typecheck tools.`
};

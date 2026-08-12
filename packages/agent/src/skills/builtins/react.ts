import type { Skill } from "../types.js";

export const reactSkill: Skill = {
  name: "react",
  description: "React component architecture, hook guidelines, state management, and lifecycle patterns.",
  category: "framework",
  version: "1.0.0",
  instructions: `### Skill: React Guidelines
- Build functional components using React hooks (useState, useEffect, useMemo, useCallback).
- Keep state local to where it is consumed; lift state up only when shared across components.
- Ensure stable key props when rendering dynamic element lists.
- Avoid side effects inside render paths; encapsulate side effects within useEffect.`
};

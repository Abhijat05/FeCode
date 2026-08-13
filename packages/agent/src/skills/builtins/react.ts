import type { Skill } from "../types.js";

export const reactSkill: Skill = {
  name: "react",
  description: "React component architecture, hook guidelines, state management, and lifecycle patterns.",
  category: "framework",
  version: "2.0.0",
  activation: {
    when: ["writing React components", "managing React state", "authoring custom hooks"]
  },
  instructions: [
    "Build functional components using React hooks (useState, useEffect, useMemo, useCallback).",
    "Keep state local to where it is consumed; lift state up only when shared across components.",
    "Ensure stable key props when rendering dynamic element lists."
  ],
  rules: [
    "Avoid side effects inside render paths; encapsulate side effects within useEffect.",
    "Never mutate state or props objects directly."
  ],
  antiPatterns: [
    "Avoid mutating private DOM properties directly.",
    "Avoid pushing draft objects into global array states without local immutable updates."
  ]
};

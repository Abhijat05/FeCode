import type { Skill } from "../types.js";

export const frontendDesignSkill: Skill = {
  name: "frontend-design",
  description: "Visual hierarchy, typography, responsive layout, and clean component composition guidelines.",
  category: "frontend",
  version: "2.0.0",
  activation: {
    when: ["creating UI components", "modifying frontend layouts", "redesigning pages"],
    notWhen: ["backend-only tasks"]
  },
  instructions: [
    "Establish clear visual hierarchy using typography scales, font weights, and contrasting colors.",
    "Maintain consistent spacing and grid alignments using container padding and relative units.",
    "Design responsive, fluid layouts adapting gracefully to desktop, tablet, and mobile viewports."
  ],
  workflow: [
    "1. Analyze primary UI utility and direct interaction models.",
    "2. Establish container layout grid and responsive breakpoints.",
    "3. Style visual interactive states (hover, focus, active, disabled)."
  ],
  rules: [
    "Every interactive element must have explicit focus and hover states.",
    "Ensure internal content and dimensions of controls are fluidly responsive to screen size."
  ],
  antiPatterns: [
    "Avoid unconstrained massive typography without proper tracking.",
    "Avoid textureless surfaces or over-nested cards.",
    "Avoid icon-stuffed bento boxes or generic colored border outlines."
  ],
  examples: [
    {
      title: "Responsive Card Composition",
      example: "<article className=\"p-6 rounded-lg bg-surface text-on-surface shadow-md hover:shadow-lg transition-shadow\">\n  <h2 className=\"text-xl font-semibold tracking-tight\">Card Title</h2>\n</article>"
    }
  ]
};

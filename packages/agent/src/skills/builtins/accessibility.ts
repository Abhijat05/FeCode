import type { Skill } from "../types.js";

export const accessibilitySkill: Skill = {
  name: "accessibility",
  description: "Semantic HTML, keyboard navigation, focus management, and ARIA best practices.",
  category: "accessibility",
  version: "1.0.0",
  instructions: `### Skill: Web Accessibility (a11y)
- Use native semantic HTML elements (<button>, <main>, <nav>, <header>, <article>) prior to adding ARIA roles.
- Ensure all interactive elements are reachable and operable via keyboard navigation (Tab, Enter, Space, Escape).
- Maintain visible focus outlines for interactive elements.
- Ensure adequate color contrast ratios between text and background.
- Provide explicit labels for form inputs and accessible image alt text.`
};

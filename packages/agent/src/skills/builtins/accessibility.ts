import type { Skill } from "../types.js";

export const accessibilitySkill: Skill = {
  name: "accessibility",
  description: "Semantic HTML, keyboard navigation, focus management, and ARIA best practices.",
  category: "accessibility",
  version: "2.0.0",
  activation: {
    when: ["authoring interactive components", "building form controls", "auditing keyboard navigation"]
  },
  instructions: [
    "Use native semantic HTML elements (<button>, <main>, <nav>, <header>, <article>) prior to adding ARIA roles.",
    "Ensure all interactive elements are reachable and operable via keyboard navigation (Tab, Enter, Space, Escape).",
    "Maintain visible focus outlines for interactive elements."
  ],
  rules: [
    "Form inputs must have explicit accessible labels.",
    "Images must provide non-empty alt descriptions or aria-hidden=true if decorative."
  ],
  antiPatterns: [
    "Avoid replacing native interactive elements with click handlers on unhandled <div> tags.",
    "Avoid stripping focus outlines without providing alternative visual indicators."
  ]
};

import type { Skill } from "../types.js";

export const testingFrontendSkill: Skill = {
  name: "testing-frontend",
  description: "User-centric component testing, state verification, and maintainable test suites.",
  category: "testing",
  version: "2.0.0",
  activation: {
    when: ["writing component unit tests", "testing user interaction flows", "verifying DOM states"]
  },
  instructions: [
    "Test component behavior and user interactions rather than internal implementation details.",
    "Query elements using accessible roles, labels, or test-ids rather than fragile CSS class selectors.",
    "Assert expected DOM state changes, asynchronous loading, and error states cleanly."
  ],
  workflow: [
    "1. Render component with deterministic props.",
    "2. Simulate user events (clicks, typing, keyboard navigation).",
    "3. Assert visible DOM updates and output state."
  ],
  rules: [
    "Keep test fixtures isolated, clean, and repeatable."
  ]
};

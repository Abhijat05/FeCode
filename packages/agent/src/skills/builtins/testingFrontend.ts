import type { Skill } from "../types.js";

export const testingFrontendSkill: Skill = {
  name: "testing-frontend",
  description: "User-centric component testing, state verification, and maintainable test suites.",
  category: "testing",
  version: "1.0.0",
  instructions: `### Skill: Frontend Component Testing
- Test component behavior and user interactions rather than internal implementation details.
- Query elements using accessible roles, labels, or test-ids rather than fragile CSS class selectors.
- Assert expected DOM state changes, asynchronous loading, and error states cleanly.
- Keep test fixtures isolated and deterministic.`
};

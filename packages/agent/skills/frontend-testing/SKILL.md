---
name: frontend-testing
description: Frontend testing strategy, component tests, integration tests, and behavioral assertions.
category: testing
version: 2.1.0
---

## When to use

- writing frontend tests
- fixing failing tests
- implementing testing strategy

## Instructions

### Project Detection & Existing Rules
- **Inspect package.json & Configuration**: Check existing test scripts, testing libraries (Jest, Vitest, Cypress, Playwright, React Testing Library), and conventions.
- **Follow existing patterns**: Do not introduce another testing framework when one already exists.

### Core Mental Model
- Tests should provide confidence about behavior.
- Prefer testing what the user/system observes over testing internal implementation details.

## Rules

### Testing Layers
- **Unit Tests**: Good for pure functions, utilities, and complex logic isolation.
- **Component Tests**: Good for verifying UI state, props, and user interaction.
- **Integration/E2E Tests**: Good for verifying that the entire system coordinates correctly.
- Do not insist every project needs every layer. Match the project's strategy.

### What to Test
Prioritize:
- important user behavior (submitting a form, navigating)
- business logic
- regressions
- edge cases, error states, and loading states

### What Not to Test
Avoid tests that only verify:
- internal implementation details (e.g. checking if a specific internal variable is set to true)
- trivial framework behavior (e.g. testing that a React component renders a div)
- exact DOM structure without behavioral significance

### Mocking
Before mocking:
- Ask whether the real dependency can safely be used (e.g., testing against the real DOM or an in-memory database).
- Avoid excessive mocking that makes tests pass while hiding genuine integration bugs.

### Async UI
Test loading, success, error, retry, and empty states.
- **Do not assert immediately** before asynchronous behavior completes. Use asynchronous finders (`findBy`, `waitFor`).

### Forms
Test valid submission, invalid input, validation errors, disabled/loading states, and submission failure.

### Accessibility
Where appropriate, include accessible queries (e.g., `getByRole`) and basic accessibility verification to implicitly test a11y alongside behavior.

## Anti-Patterns

- **Brittle selectors**
  - *What*: Querying elements by CSS classes (e.g., `.btn-primary-wrapper > div`).
  - *Why*: Any minor styling or DOM structure change breaks the test, even if the user behavior is intact.
  - *Instead*: Query by accessible roles, labels, or explicit test IDs (`getByRole('button', { name: /submit/i })`).
- **Testing implementation details**
  - *What*: Asserting that a component called `setState(true)` internally.
  - *Why*: Refactoring the component (e.g., to use `useReducer`) breaks the test even if the UI still works perfectly.
  - *Instead*: Assert on the visible UI changes (e.g., expecting a loading spinner to appear).
- **Excessive mocking**
  - *What*: Mocking every child component in a tree.
  - *Why*: The test passes, but the application might crash in production because the components don't actually integrate correctly.
  - *Instead*: Use shallow rendering sparingly. Render the real components unless they trigger expensive or un-mockable side effects.

## Workflow

### Debugging
When a test fails:
1. Understand the failure.
2. Determine whether the application behavior or the test assumptions are wrong.
3. Inspect relevant code and reproduce the failure.
4. Make the smallest appropriate fix.
5. Do not modify tests merely to make failures disappear.

### Verification
- Run targeted tests during iteration to get fast feedback.
- Run the broader suite (the project's actual test command) before completion.

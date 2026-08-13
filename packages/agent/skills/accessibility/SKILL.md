---
name: accessibility
description: Practical web accessibility implementation, ARIA semantics, keyboard navigation, and focus management.
category: accessibility
version: 2.1.0
---

## When to use

- building interactive components
- fixing accessibility defects
- writing semantic HTML

## Instructions

### Project Detection & Existing Rules
- **Inspect package.json & Configuration**: Check if the project uses specific accessibility linters (`eslint-plugin-jsx-a11y`) or UI component libraries (like Radix or Headless UI) that handle accessibility primitives.
- **Follow existing patterns**: Integrate with existing accessibility patterns in the project.

### Core Mental Model
- Accessibility means the interface remains usable across keyboard, screen readers, different input methods, visual abilities, cognitive contexts, and motion preferences.
- It is not merely "use semantic HTML"—it is about communicating state, identity, and behavior to all users.

## Rules

### Semantic HTML
Before adding ARIA:
- Ask whether native HTML already provides the correct semantics.
- Prefer native elements (`<button>`, `<nav>`, `<main>`) over recreating them with `<div>` and ARIA roles.

### Buttons vs Links
- Use **buttons** (`<button>`) for actions that change state or trigger behavior on the page.
- Use **links** (`<a>`) for navigation to new URLs or anchors.
- Do not create clickable divs when a native element exists.

### Keyboard
- Every interactive feature must have an intentional keyboard interaction.
- Check tab order (`tabindex="0"` for interactive elements only, avoid positive `tabindex`).
- Check activation (Space/Enter).
- Verify focus visibility.
- Prevent keyboard traps.

### Focus
Before removing outlines or focus indicators:
- Provide an equivalent, clearly visible focus state for keyboard users (`:focus-visible`).

### Forms
- Ensure inputs have associated labels (`<label for="...">` or `aria-labelledby`).
- Associate error messaging with inputs using `aria-describedby` or `aria-errormessage`.
- Provide useful validation messaging and indicate required state (`aria-required="true"` or `required` attribute).

### ARIA
- Use ARIA to communicate semantics that native HTML cannot express (e.g. `aria-expanded`, `aria-controls`).
- **Do not add redundant ARIA** (e.g. `<button role="button">`).
- **Do not use ARIA to repair incorrect markup** when simply changing to the correct native HTML tag solves the problem.

### Dynamic UI
- For dialogs, menus, popovers, and loading states: focus management must be intentional (e.g., trapping focus inside a modal, returning focus to the trigger on close).
- Use live regions (`aria-live`) for dynamic validation errors or status updates.

### Motion
- Respect `prefers-reduced-motion` media queries for animations.
- Do not make motion the only way information is communicated.

### Color
- Do not communicate meaning through color alone (e.g., use an icon or text alongside a red border for an error state).
- Ensure sufficient color contrast.

## Anti-Patterns

- **Clickable divs**
  - *What*: `<div onClick={handleClick}>Submit</div>`.
  - *Why*: Divs are not focusable by default and do not respond to Enter/Space keys, making them inaccessible to keyboard/screen reader users.
  - *Instead*: Use a `<button>`.
- **Missing labels**
  - *What*: `<input type="text" placeholder="Search" />` without a label.
  - *Why*: Screen readers may not read the placeholder, leaving users blind to the input's purpose.
  - *Instead*: Provide a visible `<label>` or `aria-label`.
- **Invisible focus**
  - *What*: `outline: none;` without providing a replacement `:focus` or `:focus-visible` style.
  - *Why*: Keyboard users lose track of where they are on the page.
  - *Instead*: Keep the default outline or provide a high-contrast custom focus ring.
- **Unnecessary ARIA**
  - *What*: Adding `role="navigation"` to a `<nav>` element.
  - *Why*: It is redundant and adds noise for screen readers.
  - *Instead*: Just use `<nav>`.

## Workflow

### Debugging
- Determine if the issue is a missing semantic element, missing keyboard support, or incorrect ARIA state.
- Inspect the Accessibility Tree in the browser (if available).

### Verification
- Verify keyboard navigation manually or via tests.
- Inspect semantic markup.
- Run automated accessibility checks (`eslint-plugin-jsx-a11y`, `axe-core`) where available in the project.
- Do not claim automated accessibility verification succeeded unless a real tool was executed.

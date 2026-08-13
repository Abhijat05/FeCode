---
name: tailwind
description: Tailwind CSS utility composition, responsive behavior, design tokens, and state variants.
category: styling
version: 2.1.0
---

## When to use

- styling components with Tailwind CSS
- building responsive layouts with utility classes

## Instructions

### Project Detection & Existing Rules
- **Inspect package.json & Configuration**: Check Tailwind version, `tailwind.config.js`, CSS entrypoints, and existing utility conventions.
- **Design Tokens**: Identify existing design tokens (custom colors, spacing, typography, radius, shadows). **Prefer existing project tokens.**
- **Do not force Tailwind** onto projects that do not use Tailwind.

### Design Tokens
- Do not introduce arbitrary values (`[#ff0000]`) when existing project tokens or standard scales can be used.

### Composition
- Group utilities logically (e.g., layout first, then spacing, typography, visual).
- Build reusable component patterns cleanly.
- Keep class strings understandable.
- Avoid duplicated utility combinations by extracting heavily repeated patterns into component abstractions (use React/Vue/Svelte components, avoid `@apply` unless it is a strong project convention).

### Responsive
- Use responsive variants (`sm:`, `md:`, `lg:`) for fluid viewport adaptations.
- Understand mobile-first behavior (unprefixed is mobile).
- **Do not simply add every breakpoint.** Design for fluidity.
- Follow `responsive-design` guidance for viewport behavior.

### State
- Use interactive state modifiers (`hover:`, `focus:`, `focus-visible:`, `active:`, `disabled:`).
- Use `group` and `peer` for complex relational state styling.

### Dark Mode
- Respect the project's existing dark-mode strategy (e.g., `class` strategy vs `media`).
- Do not introduce a new strategy. Use `dark:` variants appropriately.

### Arbitrary Values
- Arbitrary values are justified for highly specific, one-off cases (e.g., a specific background image position or precise translation).
- Prefer project tokens or standard scales when appropriate.
- Do NOT make arbitrary values categorically forbidden, but use them sparingly.

### Component Boundaries
- Do not create component abstractions solely because a class list is long.
- Balance readability, reuse, and project conventions.

### Common Failure Modes
- **Contradictory utilities**: Applying both `p-4` and `p-6` to the same element, causing specificity surprises.
- **Excessive arbitrary values**: Flooding the codebase with `[14px]` instead of using `text-sm`.
- **Duplicated classes**: Repeating the exact same long string of classes across multiple sibling elements instead of mapping over data or extracting a component.
- **Breakpoint proliferation**: Hardcoding too many breakpoint overrides instead of trusting flexible layouts like Flexbox or Grid.
- **Ignoring existing tokens**: Hardcoding hex codes instead of using the theme configuration.
- **Inconsistent responsive behavior**: Forgetting to scale typography along with layout at different viewports.

## Anti-Patterns

- **Arbitrary Values over Scale Tokens**
  - *What*: Writing `w-[64px]` instead of `w-16`.
  - *Why*: It breaks design consistency and bloats the generated CSS.
  - *Instead*: Use the standard tailwind scale.
- **Heavy use of @apply**
  - *What*: Putting `@apply text-sm font-bold text-red-500` inside CSS files frequently.
  - *Why*: It defeats the purpose of utility-first CSS and creates hidden specificity issues.
  - *Instead*: Extract the HTML into a reusable framework component (React/Vue/Svelte).

## Workflow

### Verification
- Use project linting, build, typecheck, and test scripts to verify the styling does not break UI components.

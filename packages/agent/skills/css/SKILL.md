---
name: css
description: Cascading Style Sheets architecture, layout, specificty, and modern responsive mechanics.
category: styling
version: 2.1.0
---

## When to use

- writing CSS
- modifying layouts
- resolving visual defects

## Instructions

### Project Detection & Existing Rules
- **Inspect package.json & Stylesheets**: Determine if the project uses plain CSS, CSS Modules, Sass/Less, or utility frameworks (e.g. Tailwind).
- **Follow existing patterns**: Do not introduce a styling architecture that the project does not use (like dropping in Tailwind classes into a CSS Modules project).
- **Respect naming conventions**: Use existing class naming conventions (e.g. BEM).

### Core Mental Model
- **Cascade & Inheritance**: Rules apply based on cascade origin, specificity, and source order. Properties like color and font inherit, while layout properties do not.
- **Specificity**: Browsers calculate selector weight. Inline > ID > Class/Attribute/Pseudo-class > Element/Pseudo-element.
- **Source Order**: Later rules win when specificity is equal.
- **Box Model**: Elements have content, padding, border, and margin. Use `box-sizing: border-box`.
- **Containing Blocks**: Absolute positioning is relative to the nearest positioned ancestor.
- **Layout vs Decoration**: Separate properties that affect document flow (flex, grid, width) from decorative properties (color, background).

## Rules

### Layout
Before using `position: absolute`:
- Ask whether normal document flow, flexbox, or CSS grid solves the layout more robustly.

### Flexbox vs Grid
- **Flexbox**: Use for 1-dimensional layouts (a row or a column) where content dictates the size.
- **Grid**: Use for 2-dimensional layouts where the structural grid dictates the layout.

### Fixed vs Fluid
- Prefer fluid constraints (`%`, `vw`, `vh`, `fr`) when content and viewport can vary.
- Avoid rigid fixed widths (`width: 500px`) that will break on mobile devices.

### z-index
Before increasing `z-index`:
- Inspect stacking contexts. A high `z-index` inside a lower stacking context will not overlay elements in a higher stacking context.
- Do not solve every layering problem by setting a huge `z-index` (e.g. `z-index: 9999`).

### Specificity
Before adding `!important`:
- Determine which selector or cascade rule is causing the conflict.
- Avoid specificity escalation by refactoring the selector to match the target's specificity organically.

### Responsive CSS
- Prefer content-driven breakpoints over excessive device-specific media queries.

### Modern CSS
- Use custom properties (CSS variables), `clamp()`, `min()`, `max()`, container queries, logical properties, and modern color functions where appropriate.
- **Browser Support**: Do not force modern features when the project's browser support does not allow them. Check existing CSS files for compatibility clues.

## Anti-Patterns

- **!important everywhere**
  - *What*: Slapping `!important` on properties that don't apply or just to win a specificity war.
  - *Why*: It breaks the cascade and makes future maintenance a nightmare of specificity wars.
  - *Instead*: Find the conflicting rule and match or slightly exceed its specificity organically.
- **Arbitrary z-index escalation**
  - *What*: Using `z-index: 99999`.
  - *Why*: It leads to unpredictable layering and arms races between components.
  - *Instead*: Manage stacking contexts carefully and use a sensible, planned z-index scale.
- **Fixed widths for fluid content**
  - *What*: Setting `width: 800px` on a container.
  - *Why*: It causes horizontal scrolling or cropping on narrow viewports.
  - *Instead*: Use `max-width: 800px; width: 100%`.
- **Deeply nested selectors**
  - *What*: Writing `.card .body .title span { ... }`.
  - *Why*: It inflates specificity, making it very hard to override styles later.
  - *Instead*: Use flatter selector structures (e.g., BEM `.card__title`).

## Workflow

### Debugging
- Inspect computed styles in the browser (if available) to see which rules are winning.
- Check the box model (padding, border, margin) to understand element sizing.
- Inspect layout dimensions, parent constraints, and overflow settings.
- Verify stacking contexts when diagnosing z-index issues.
- Do not claim browser inspection is available unless a browser tool is actively being used.

### Verification
- Ensure the layout responds correctly across narrow and wide simulated viewports.
- Run project CSS linting (e.g. Stylelint) and build steps to verify syntax.

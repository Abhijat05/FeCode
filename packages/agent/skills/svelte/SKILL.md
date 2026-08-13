---
name: svelte
description: Svelte components, compiler-driven reactivity, local/derived state, and SvelteKit boundaries.
category: framework
version: 2.1.0
---

## When to use

- authoring Svelte components
- handling Svelte reactive statements
- working with Svelte stores or SvelteKit

## Instructions

### Project Detection & Existing Rules
- **Version Detection**: The agent must inspect the project's Svelte version (e.g., Svelte 3/4 vs Svelte 5).
- Distinguish modern Svelte patterns (like runes in Svelte 5: `$state`, `$derived`) from older syntax.
- **Do not blindly apply legacy syntax** to a modern project, and do not force modern runes on older projects.
- **SvelteKit Check**: Inspect if the project uses SvelteKit. **Do not assume SvelteKit** when the project is plain Svelte.

### Core Mental Model
- **Component-based UI**: Svelte compiles components to highly efficient imperative code.
- **Compiler-driven reactivity**: Assignments (or runes) trigger updates, no virtual DOM overhead.
- **Local State**: State scoped to a component.
- **Derived State**: Values that automatically update when dependencies change.
- **Effects**: Side-effects triggered by state changes.

### Components
- Single-file components (`.svelte`) contain `<script>`, HTML markup, and scoped `<style>`.
- Understand composition, slots/snippets, and clear component boundaries.

### Props
- Explain the appropriate prop mechanism for the project's Svelte version (`export let` in Svelte 3/4 vs `let { prop } = $props()` in Svelte 5).
- Respect existing project conventions.

### Reactivity
- Cover local state, derived values, effects, and dependency tracking.
- Explain version-specific differences when relevant (`$:` vs runes).

### Events / Communication
- Parent-child communication via props and events.
- Use callbacks or event dispatchers (`createEventDispatcher`) appropriate to the project's Svelte version.
- Do not force legacy APIs when modern conventions are already used.

### Stores
- Stores are useful for shared state, cross-component state, or application-level state.
- **Do not use stores for state that naturally belongs to a component.** Keep local state local.

### Lifecycle
- Initialization, cleanup, subscriptions, and browser-only behavior (`onMount`, `onDestroy`).

### SvelteKit
- **Only apply SvelteKit guidance when the project actually uses SvelteKit.**
- Routing, load/data patterns (`+page.ts`, `+page.server.ts`).
- Form actions and server/client boundaries.
- Hooks and page/layout structure.

### Common Failure Modes
- **Incorrect reactive assumptions**: Expecting reactivity from object mutation without reassignment (Svelte 3/4).
- **Unnecessary stores**: Using a global store for a value that is only used inside one component.
- **Browser/server mistakes**: Using `window` during SSR.
- **Lifecycle misuse**: Running heavy logic in component initialization instead of `onMount`.
- **Unnecessary client-side work**: Failing to utilize SvelteKit server load functions.

## Anti-Patterns

- **Mutating objects without reassignment (Svelte 3/4)**
  - *What*: Calling `.push()` on an array instead of reassigning it.
  - *Why*: The Svelte compiler tracks assignments (`=`). Array `.push()` or object mutations won't trigger updates.
  - *Instead*: Reassign the variable (e.g. `arr = [...arr, newItem]`).
- **Overusing global stores**
  - *What*: Creating a store for simple component-level UI state (like an "isOpen" toggle).
  - *Why*: It breaks encapsulation and makes components harder to test.
  - *Instead*: Pass props or use context for localized tree state.

## Workflow

### Debugging
- Inspect reactive statements and dependencies.
- Use `console.log` inside reactive blocks to trace data flow.
- Follow `frontend-debugging` workflow when diagnosing rendering problems.

### Verification
- Typecheck using `svelte-check` or the project's `tsc` setup.
- Run project lint, test, and build scripts.

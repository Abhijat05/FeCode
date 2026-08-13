---
name: vue
description: Vue 3 Composition API, Options API, single-file components, and reactivity patterns.
category: framework
version: 2.1.0
---

## When to use

- authoring Vue components
- using Vue Composition API or Options API
- handling Vue reactive state

## Instructions

### Project Detection & Existing Rules
- **Inspect package.json**: Identify Vue version (e.g., Vue 2 vs Vue 3).
- **API Style**: Check if the existing project uses Composition API (`<script setup>`) or Options API (`export default { data() ... }`).
- **Follow existing patterns**: Do not force Composition API if the existing project uses Options API, unless the user explicitly requests migration.

### Core Mental Model
- **Components**: Encapsulated UI units.
- **Props**: Immutable inputs from parents.
- **Emits**: Custom events emitted to parents.
- **Reactive State**: Mutable UI state driving the template.
- **Computed Values**: Derived reactive state.
- **Watchers**: Side effects triggered by reactive state changes.

### Reactivity
- Distinguish between **reactive state**, **computed values**, and **watchers**.
- Prefer computed values (`computed()`) for derived state.
- Use watchers (`watch()`, `watchEffect()`) for side effects rather than ordinary derivation.

### Composition
- Use Vue Single File Components (.vue).
- Extract reusable logic into composables (when using Composition API).
- Maintain clear component boundaries; break down large templates into smaller components.
- Use slots for flexible component composition and content distribution.
- Use provide/inject for deep dependency injection when appropriate.

### Forms
- Use `v-model` for two-way data binding on form inputs.
- Handle validation, loading/error states, and controlled data flow cleanly.

### Common Failure Modes
- **Unnecessary watchers**: Using watchers to update state when a computed property would suffice.
- **Mutating props incorrectly**: Attempting to mutate props directly, which violates one-way data flow.
- **Duplicated derived state**: Initializing state with a prop value instead of computing it dynamically.
- **Incorrect reactive references**: Forgetting `.value` when accessing refs in the script section (Composition API).
- **Overly large components**: Failing to break down monolithic Vue files.

## Anti-Patterns

- **Mutating props directly**
  - *What*: Directly editing a prop passed from a parent component.
  - *Why*: It creates unpredictable data flow and Vue will emit warnings.
  - *Instead*: Emit an event to the parent to update the data, or use a writable computed property.
- **Using watchers for derived state**
  - *What*: Putting logic in a `watch` block to calculate a value from other state.
  - *Why*: It's imperative, harder to track, and often leads to out-of-sync state.
  - *Instead*: Use `computed()` to declaratively derive state.

## Workflow

### Debugging
- Use Vue DevTools to inspect component state, props, and emitted events.
- Check if reactivity is lost by inspecting object destructuring (use `toRefs` if necessary).

### Verification
- Run project linting.
- Run project tests.
- Build the project using the existing scripts.

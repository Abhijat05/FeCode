---
name: frontend-debugging
description: Systematic frontend diagnosis and repair methodology. Apply when a UI component, layout, interaction, or state is broken or behaving unexpectedly. This skill teaches structured debugging — reproduce, inspect, isolate, hypothesize, minimal change, verify — rather than guessing and editing code that looks wrong.
category: frontend
version: 1.0.0
---

# Frontend Debugging

## When to use
- A UI component renders incorrectly or not at all
- A layout breaks at a specific viewport width or state
- An interactive element does not respond as expected
- A data display shows wrong, missing, or stale information
- A runtime error appears in the console
- A CSS or styling rule does not apply as expected
- A state transition produces unexpected UI behavior

## When not to use
- Purely backend API issues with no UI impact
- Writing new features from scratch (use frontend-design instead)
- Reviewing code quality without a specific failure (use ui-review instead)

## Instructions
- Do not edit code because something "looks wrong" — form a concrete diagnosis first.
- Use the existing FeCode tools (list_directory, read_file, search_files) to gather information before hypothesizing.
- Classify the problem type before attempting a fix: rendering, styling, state, data, event, or environment.
- Prefer the smallest possible change that fixes the actual root cause over refactoring the surrounding code.
- Verify the fix resolves the original symptom and does not introduce regressions.
- Never suppress or hide an error to make verification pass.

## Core Debugging Principle

Follow this sequence:

```
Symptom
  → Reproduce
  → Inspect
  → Isolate
  → Hypothesize
  → Minimal change
  → Verify
  → Re-check
```

Do not skip steps. Skipping reproduction and inspection leads to guessing, which leads to changes that mask symptoms rather than fix causes.

## Step 1: Understand the Symptom

Before touching any file:
- What exactly is broken? (visual glitch, wrong output, no output, crash, interaction failure)
- Where does it happen? (specific page, component, viewport, state, user action)
- When does it happen? (always, sometimes, specific condition, after a particular action)
- Is it consistent or intermittent?
- What is the expected behavior vs. the observed behavior?

Do not proceed until you can state the symptom precisely.

## Step 2: Reproduce or Establish the Failing Condition

If you cannot reproduce the problem, you cannot verify the fix.

- Identify the exact path through the application that triggers the failure
- Identify whether the failure depends on a specific viewport, data state, user action, or environment
- For intermittent failures, identify the conditions that increase the likelihood

If browser tools are available, inspect:
- Console errors and stack traces
- Network requests and failures
- DOM state at the moment of failure
- Applied CSS rules

Do not invent browser output when browser tools are unavailable. Work from code inspection instead.

## Step 3: Investigate the Repository

Use FeCode tools to gather information before forming a hypothesis:

```
list_directory     — understand file structure
search_files       — find component, class name, or error message
read_file          — inspect the relevant component, styles, data source
```

Inspect in this order:
1. The component where the symptom appears
2. Its parent component (props, context, state passed down)
3. Associated styles or class names
4. Data source or API response shape
5. State management (local state, context, store)
6. Routing and navigation (if the issue is page-level)
7. Configuration (if the issue looks environmental)

Read the actual code — do not rely on assumptions about what it probably does.

## Step 4: Classify the Problem

Before hypothesizing a fix, identify what category the problem belongs to:

| Category | Indicators |
|----------|-----------|
| **Rendering** | Component not appearing, wrong element rendered, conditional rendering issue |
| **Styling/CSS** | Element appears but looks wrong — position, size, color, visibility |
| **State** | UI shows stale data, updates don't propagate, wrong value displayed |
| **Data** | Fetched data is wrong, missing, or in an unexpected shape |
| **Event/Interaction** | Handler not firing, wrong handler attached, event not propagating |
| **Environment** | Works locally but not in another environment; configuration or API key issue |

Solving the wrong category wastes time. A styling fix will not resolve a state problem.

## CSS and Layout Debugging

When a CSS issue is suspected, reason systematically through:

- **Box model**: `width`, `height`, `padding`, `border`, `margin`
- **Display**: `block`, `inline`, `flex`, `grid`, `inline-flex`, `none`
- **Position**: `static`, `relative`, `absolute`, `fixed`, `sticky`
- **Overflow**: `visible`, `hidden`, `scroll`, `auto` — and which ancestor creates the clipping context
- **Stacking contexts**: `z-index` only works within the same stacking context
- **Flex sizing**: `flex-grow`, `flex-shrink`, `flex-basis`, `min-width: 0`
- **Grid sizing**: explicit vs. implicit tracks, `fr` units, `minmax()`
- **Specificity**: which rule is actually winning, and why
- **Inheritance**: some properties inherit unexpectedly

**Common CSS traps:**
- `overflow: hidden` on a parent clips children with `position: sticky`
- `min-width` defaults on flex items prevent shrinking — add `min-width: 0`
- `z-index` on an element inside a stacking context with `z-index: 0` cannot escape it
- `height: 100%` requires an ancestor with an explicit height

## State and Data Debugging

- Confirm that the data source (API, store, prop, context) is actually returning what you expect
- Confirm that state updates trigger re-renders where needed
- Confirm that async operations (fetch, suspense, streaming) are completing before the component tries to render
- Distinguish between "data is wrong" and "data is correct but rendered incorrectly"

## Step 5: Form a Concrete Hypothesis

Before changing any file, state your hypothesis explicitly:

> "I believe the problem is X, caused by Y, and the fix is Z."

If you cannot form a specific hypothesis, gather more information rather than trying random edits.

## Step 6: Make the Minimal Change

- Fix the root cause, not the symptom
- Do not refactor the entire component to fix a single CSS property
- Do not add workaround overrides when the underlying issue can be fixed directly
- Do not restructure state management when the display logic is wrong

Prefer surgical edits. The more code you change, the more you risk introducing regressions.

## Step 7: Verify

After making the fix:
1. Re-read the changed code — does it actually address the root cause?
2. Run any relevant tests or build checks
3. Mentally or actually reproduce the original failing scenario
4. Check adjacent states: does fixing one state break another?
5. Check any related components that may share the affected code

## Debugging Workflow

1. Understand the symptom precisely.
2. Reproduce or establish the failing condition.
3. Use list_directory, search_files, and read_file to gather information.
4. Read the component, its parents, its styles, and its data source.
5. Classify the problem type.
6. Form a concrete hypothesis about the root cause.
7. Make the smallest appropriate change.
8. Verify: re-read, run checks, reproduce the original scenario.
9. Confirm the original failure is resolved.
10. Check for regressions in related states and components.

## Avoid

- Editing code because it "looks like" the problem without verifying through inspection.
- Changing multiple files simultaneously before understanding the issue — each change obscures what fixed what.
- Rewriting a component to fix a problem that was in a single property.
- Adding CSS overrides that mask the real issue rather than correcting it.
- Hiding errors with try/catch or null checks without addressing the underlying cause.
- Disabling TypeScript or lint checks to make verification pass — if they flag something, investigate it.
- Declaring success before reproducing the original scenario with the fix applied.
- Inventing browser console output when browser tools are unavailable.

## Examples

### Example: Diagnosing layout overflow before editing

Wrong approach: "The component looks too wide, I'll add `overflow: hidden` to the parent."

Correct approach: Identify which specific element is causing overflow. Check `min-width` on flex children (common culprit). Inspect the box model of the overflowing element. Fix the constraint that prevents correct shrinking, not the visibility of the overflow.

### Example: State vs. rendering classification

Symptom: "The user's name shows the old value after they update their profile."

Classify first: Is the API returning the old value? Is the store not updating? Is the component not re-rendering? Is it re-rendering but showing a stale closure value? Each of these has a different fix. Read the data flow before editing.

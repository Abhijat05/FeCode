---
name: react
description: React component architecture, state management, effect guidelines, and rendering behavior.
category: framework
version: 2.1.0
---

## When to use

- writing React components
- managing React state
- authoring custom hooks
- React application
- JSX/TSX React work

## When not to use

- non-React frontend work

## Instructions

### Project Detection & Existing Rules
- **Inspect package.json**: Identify the React version (e.g. 17 vs 18 vs 19).
- **Inspect established conventions**: Check how the project handles state, side effects, and composition.
- **Follow existing patterns**: Do not impose a new architecture (like switching state management libraries) simply because it is preferred, unless explicitly requested.

### Core Mental Model
- **Components**: UI rendering units receiving inputs (props) and returning UI.
- **Props**: Immutable inputs from parents.
- **State**: Owned mutable UI state; changing it triggers re-renders.
- **Derived Values**: Variables calculated from props or state during render. They are not state themselves.
- **One-way Data Flow**: Data flows down, actions flow up.

### Common Failure Modes
- **Stale Closure**: 
  - *What it looks like*: A function (like inside an effect or timeout) uses an old value of state or props, rather than the latest.
  - *Common cause*: Missing or incorrect dependency arrays in hooks (`useEffect`, `useCallback`).
  - *What to inspect*: The dependency array of the hook and the variables referenced inside the closure.
  - *Appropriate fix*: Add missing dependencies, use the functional state updater (e.g., `setCount(c => c + 1)`), or use `useRef` for values that shouldn't trigger renders but need to be fresh.
- **Infinite Effect Loop**:
  - *What it looks like*: The browser hangs or the console floods with re-render warnings.
  - *Common cause*: Unstable dependencies (e.g., creating a new object/array/function on every render and passing it to a dependency array) or state updates inside effects that re-trigger the same effect.
  - *What to inspect*: The dependency array and state setters inside the effect. 
  - *Appropriate fix*: Stabilize dependencies with `useMemo`/`useCallback`, move logic inside the effect, or determine whether the effect should exist at all (often it can be derived during render).
- **State Out of Sync**:
  - *What it looks like*: Updating one piece of state doesn't update related UI.
  - *Common cause*: Duplicated state (e.g., passing a prop and storing it in state) or derived state stored separately.
  - *What to inspect*: Multiple competing sources of truth.
  - *Appropriate fix*: Lift state up or compute the derived value directly during render.
- **Incorrect Keys**:
  - *What it looks like*: List items re-render completely, input focus is lost, or the wrong item is deleted.
  - *Common cause*: Using array indexes as keys when list ordering or identity changes (e.g., filtering, sorting, or prepending items).
  - *What to inspect*: The `key` prop on mapped list elements.
  - *Appropriate fix*: Use a unique, stable identifier (like a database ID) for the `key`. Array indexes are only acceptable if the list is completely static and never changes order or size.
- **Hydration / Server Rendering Problems**:
  - *What it looks like*: Console warnings about text content not matching between server and client, or broken styling on load. (Only relevant when the project uses SSR/server rendering like Next.js or Remix).
  - *Common cause*: Using browser-only values (like `window.innerWidth` or `localStorage`) during the initial render.
  - *Appropriate fix*: Wait until the component mounts (inside `useEffect`) to read browser-only values, or conditionally render the client-specific UI.

## Rules

### State
Before adding state, determine:
- Is the value independently mutable?
- Can it be derived from existing props/state?
- Who owns the value?
- Does another component need it?
Prefer derived values when possible. Avoid duplicated sources of truth. 
*Why*: Deriving values guarantees they are always in sync with the source of truth, eliminating entire classes of synchronization bugs.

### Effects
Before adding `useEffect`, determine:
- Is React synchronizing with an external system?
- Could this logic happen during render?
- Could this logic happen inside an event handler?
- Is this actually derived state?
Prefer avoiding an effect when no external synchronization is required.
*Good*: subscriptions, timers, DOM synchronization, external APIs where appropriate.
*Bad*: deriving one state value from another, transforming props into state unnecessarily, responding to a button click that belongs in an event handler.

### Component Extraction
Before extracting a component, determine:
- Does it have a clear responsibility?
- Does extraction improve readability?
- Is the component actually reusable?
- Does extraction clarify state ownership?
Do not extract every small JSX fragment. Only extract when it serves a structural, reuse, or performance purpose.

### Custom Hooks
Before creating a custom hook, determine whether:
- stateful behavior is reused
- effect/subscription logic is reused
- a meaningful behavioral abstraction exists
Do not create hooks merely to move code into another file.

### Context
Before introducing Context, determine:
- Is the value genuinely shared across a subtree?
- Would composition (passing components as props/children) solve the problem?
- Is the value application-wide or merely needed by nearby components?
Do not use Context as a default replacement for props.
Do not introduce a state-management library unless requested or already used.

### Memoization
Before using `useMemo`, `useCallback`, or `React.memo`, determine whether there is an actual performance problem.
Prefer simple code unless profiling or a clear rendering-cost problem justifies memoization. Memoization has its own complexity, costs memory, and is not automatically an optimization.

### Controlled vs Uncontrolled Inputs
Controlled when:
- UI state must immediately drive application state
- validation depends on current value
- other UI reacts to the value
Uncontrolled when:
- the form is simple
- DOM ownership is sufficient
- continuous React state updates are unnecessary
Do not prescribe one universally.

### Server State vs UI State
Make the distinction clear:
- *UI state*: modal open/closed, selected tab, input value.
- *Server state*: API data, remote resources, cacheable backend data.
Do not treat server data as ordinary local component state when the project already has an established server-state/data-fetching solution (like React Query, SWR, Apollo, or framework-specific routers). Do not introduce a new library.

## Workflow

1. **Inspect package.json and React version**: Understand what APIs are available.
2. **Inspect nearby components**: Understand the context of the files you are modifying.
3. **Identify existing state/data-fetching conventions**: Respect the established architecture.
4. **Identify ownership of the state being changed**: Ensure you modify the state at the correct level of the component tree.
5. **Determine whether the change needs state, derived values, effects, context, or a custom hook**: Apply the decision rules before writing code.
6. **Make the smallest change consistent with existing architecture**: Do not blindly rewrite surrounding code or impose new patterns.
7. **Check loading, error, empty, and interaction states**: Ensure the UI handles edge cases gracefully where relevant.
8. **Run the project's appropriate verification commands**: Verify the changes using the project's actual lint, typecheck, and test scripts.

## Anti-Patterns

- **Unnecessary useEffect**
  - *What*: Using an effect to update a state variable based on a change in another state variable or prop.
  - *Why*: It causes unnecessary extra renders (cascading renders) and makes data flow harder to trace.
  - *Instead*: Compute the value directly during render.
- **Duplicated derived state**
  - *What*: Copying a prop into local state to format it or modify it slightly.
  - *Why*: The local state becomes disconnected from the prop. If the parent updates the prop, the local state won't automatically update without complicated effect synchronization.
  - *Instead*: Derive the formatted value during render.
- **Premature memoization**
  - *What*: Wrapping every function in `useCallback` and every variable in `useMemo` by default.
  - *Why*: It harms code readability, increases memory overhead, and often provides zero performance benefit unless passed to a heavily re-rendered or explicitly memoized child component.
  - *Instead*: Write simple code first. Optimize only when a performance issue is observed.
- **Giant components**
  - *What*: Placing hundreds of lines of JSX and complex state logic into a single monolithic component.
  - *Why*: It creates a maintenance nightmare, mixes concerns, and causes the entire tree to re-render for minor local state changes.
  - *Instead*: Extract focused child components with clear responsibilities.
- **Unnecessary context**
  - *What*: Putting a value into a React Context provider just to avoid passing it down one or two levels.
  - *Why*: Context couples components to the provider, making them harder to reuse, and causes all consumers to re-render when the context value changes.
  - *Instead*: Use prop drilling for shallow trees, or component composition (passing JSX as `children`).
- **Unnecessary abstraction**
  - *What*: Creating highly generic, prop-heavy "smart" components (like a `BaseButton` that takes 30 props) instead of keeping things simple.
  - *Why*: The abstraction becomes too rigid and hard to understand.
  - *Instead*: Prefer simple, composable components over complex configurations.
- **Direct mutation**
  - *What*: Writing `state.user.name = "Alice"` instead of using a setter function.
  - *Why*: React relies on object identity (reference equality) to trigger re-renders. Direct mutation silently changes the object but skips the render.
  - *Instead*: Always create new objects/arrays when updating state (`setUser({ ...user, name: "Alice" })`).
- **Changing architecture without inspecting the project**
  - *What*: Installing a state management library like Zustand or Redux into a project that successfully uses React Context.
  - *Why*: It fragments the codebase and creates inconsistencies.
  - *Instead*: Adapt to the existing patterns unless explicitly requested to migrate.

## Examples

### Derived Value

Bad:
```tsx
const [fullName, setFullName] = useState("");

useEffect(() => {
  setFullName(`${firstName} ${lastName}`);
}, [firstName, lastName]);
```

Better:
```tsx
const fullName = `${firstName} ${lastName}`;
```

### Event Handler vs Effect

Bad:
```tsx
const [isSubmitting, setIsSubmitting] = useState(false);

useEffect(() => {
  if (isSubmitting) {
    postData().then(() => setIsSubmitting(false));
  }
}, [isSubmitting]);

const handleClick = () => setIsSubmitting(true);
```

Better:
```tsx
const [isSubmitting, setIsSubmitting] = useState(false);

const handleClick = async () => {
  setIsSubmitting(true);
  await postData();
  setIsSubmitting(false);
};
```

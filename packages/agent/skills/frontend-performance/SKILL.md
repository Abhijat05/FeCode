---
name: frontend-performance
description: Performance optimization, bottleneck diagnosis, and core web vitals.
category: frontend
version: 2.1.0
---

## When to use

- diagnosing slow performance
- optimizing loading times
- fixing jank or slow interactions

## Instructions

### Project Detection & Existing Rules
- **Inspect first**: Check `package.json`, build configuration, and existing performance tooling (like Lighthouse CI or bundle analyzers).
- **Respect existing architecture**: Do not introduce new dependencies or rewrite build tools unless required.

### Core Mental Model
- Performance is about user-visible outcomes such as loading, responsiveness, interaction latency, rendering, network, and memory.
- Optimization follows: MEASURE → IDENTIFY → CHANGE → VERIFY.
- Do not optimize hypothetical problems.

## Rules

### Diagnosis & Optimization Process
Before optimizing:
1. Identify the symptom.
2. Measure or inspect evidence.
3. Locate the bottleneck.
4. Make the smallest meaningful change.
5. Verify the improvement.

### Loading Performance
- **Bundle Size**: Monitor the impact of new dependencies.
- **Code Splitting**: Split code by route or large feature to reduce initial payload.
- **Lazy Loading**: Use lazy loading for offscreen or low-priority components. Do not blindly lazy-load above-the-fold content.
- **Caching**: Ensure static assets are cacheable.

### Runtime Performance
- **Unnecessary Work**: Avoid running expensive calculations on every render.
- **Large Lists**: Use virtualization or pagination for massive lists.
- **Layout Thrashing**: Avoid interleaving DOM reads and writes in the same synchronous frame.
- **Event Handlers**: Debounce or throttle high-frequency events (like scroll or resize).

### Images
- Specify dimensions (`width` and `height`) to prevent layout shifts.
- Use responsive images (`srcset`, `sizes`).
- Use modern formats (`WebP`, `AVIF`) where appropriate.
- Lazy-load below-the-fold images (`loading="lazy"`).

### Fonts
- Limit the number of font files and weights.
- Use `font-display: swap` for better perceived loading.
- Subsetting fonts can drastically reduce file size.

### JavaScript
- Avoid unnecessary client-side JavaScript.
- Audit large client-side libraries and prefer lighter alternatives when permitted.

### Rendering
- Prevent unnecessary rerenders (framework-neutral principle).
- Minimize expensive DOM updates and long tasks that block the main thread.

## Anti-Patterns

- **Optimizing without measurement**
  - *What*: Applying "performance hacks" blindly across the codebase.
  - *Why*: It complicates the code without guaranteeing any actual user benefit, and often introduces bugs.
  - *Instead*: Measure first, locate the bottleneck, then optimize.
- **Lazy-loading everything**
  - *What*: Lazy-loading above-the-fold hero images or the main routing shell.
  - *Why*: It delays the loading of critical content, worsening the Largest Contentful Paint (LCP).
  - *Instead*: Eagerly load critical assets and only lazy-load what is offscreen.
- **Excessive memoization**
  - *What*: Wrapping every single function in memoization hooks.
  - *Why*: Memoization costs memory and execution time. If the function is cheap, the overhead of memoizing it is worse than recalculating it.
  - *Instead*: Only memoize demonstrably expensive calculations or stable props passed to pure child components.

## Workflow

### Debugging
- Check network tabs for excessive payload sizes or waterfall blocking.
- Check profiling tools for long tasks or layout thrashing.

### Verification
- Use actual project tooling when available (e.g., build output, bundle analysis, profiling, Lighthouse, browser performance tools).
- **Never claim a performance improvement without evidence.** Verify via build sizes or test run metrics.

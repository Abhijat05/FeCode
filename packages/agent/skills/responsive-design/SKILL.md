---
name: responsive-design
description: Responsive layout design and debugging for interfaces that must work correctly across viewport sizes. Apply when creating new responsive layouts, fixing broken behavior at specific widths, adapting existing desktop UI for mobile, implementing fluid typography and spacing, debugging horizontal overflow, or reasoning about how UI components should behave between breakpoints.
category: frontend
version: 1.0.0
---

# Responsive Design

## When to use
- Creating new layouts that must work at multiple viewport widths
- Fixing broken or degraded behavior at specific screen sizes
- Adapting existing desktop-first UI for mobile viewports
- Implementing fluid typography, spacing, or container sizing
- Debugging unexpected horizontal scrolling or overflow
- Reasoning about navigation behavior at small sizes

## When not to use
- Component-level logic with no layout impact
- Backend or data-layer work
- Accessibility-only improvements unrelated to layout

## Instructions
- Reason about content constraints and available space before reaching for media query solutions.
- Breakpoints should emerge from where content breaks, not from device specification lists.
- Design for behavior between breakpoints — not just at standard sm/md/lg values.
- Horizontal overflow is a defect unless explicitly required; treat it that way.
- Fluid sizing through relative units, clamp(), and intrinsic layout should reduce the need for many breakpoints.
- Inspect the project's existing responsive conventions before introducing new patterns.

## Design Thinking for Responsive Interfaces

Before implementing any responsive behavior, reason through:

1. **What does the content require?** Some content is inherently wide (data tables); some can reflow naturally (cards, text). Understand the content first.
2. **What is the most constrained valid layout?** Start from the narrowest layout that works, then consider how it should expand.
3. **Where does the layout actually break?** Find the real breakpoint by considering content, not by targeting device widths.
4. **What changes between viewport sizes?** Layout, typography, spacing, navigation, interaction — identify all axes of change.
5. **How should components behave?** Sidebars, tables, cards, modals, and navbars each have distinct responsive behaviors.
6. **What existing conventions does the project use?** Breakpoint values, container widths, column behavior — inspect before overriding.

## Breakpoints

**Use breakpoints where content requires them, not at arbitrary device widths.**

Signs a breakpoint is needed:
- Content becomes unreadable or inaccessible at a particular width
- A layout composition stops working (columns become too narrow, overflow occurs)
- Navigation must fundamentally change

Signs a breakpoint is unnecessary:
- You are adding it "for mobile" without a specific layout failure
- The layout was already fluid and would have worked without it
- You are targeting a device resolution rather than a content constraint

**Avoid breakpoint proliferation.** Three to four thoughtful breakpoints serve most layouts better than seven device-specific ones.

**Always check behavior between breakpoints.** Resize the viewport gradually, not just by snapping between predefined sizes.

## Fluid Layouts

**Container strategy**
- Max-width containers centered with `margin: auto` handle wide-screen scaling without additional breakpoints
- `min-width: 0` prevents flex/grid children from overflowing their containers

**Flexible columns**
- CSS Grid with `auto-fill` / `auto-fit` and `minmax()` handles column reflow without any media queries: `grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr))`
- Flexbox with `flex-wrap: wrap` and `flex-basis` allows natural reflow

**Relative and intrinsic sizing**
- Prefer `%`, `fr`, `ch`, `em`, `rem` over `px` for dimensions that should scale
- `min-width`, `max-width`, and `min-content` / `max-content` are layout tools, not edge cases
- `clamp(min, preferred, max)` handles fluid scaling without breakpoints for font sizes and spacing

## Typography in Responsive Layouts

**Heading size**
- Display headings that are appropriate at 1400px are often overwhelming on 375px
- Use `clamp()` for fluid heading sizes: `font-size: clamp(1.5rem, 4vw, 3rem)`
- Alternatively, reduce heading scale at narrower breakpoints

**Body text**
- Body text should remain readable at all widths — avoid sizes below 14px on mobile
- Line length (measure) should stay between 55–80ch; full-width body text on wide screens needs a `max-width` constraint

**Long content behavior**
- Define how long text behaves: truncation with ellipsis, clamped lines (`-webkit-line-clamp`), or full wrapping
- Labels, button text, and navigation items may need different truncation strategies
- Test with realistic content, not short placeholder text

## Navigation

Navigation often requires the most significant behavior change between viewport sizes.

**Desktop navigation**
- Horizontal nav bars work until they overflow; plan the overflow behavior before it becomes a bug
- Ensure keyboard and focus order remain logical

**Mobile navigation**
- Collapsed navigation (hamburger/drawer/bottom bar) each have different interaction models — choose deliberately based on depth and frequency of navigation
- Touch targets must be at least 44×44px
- Drawer/modal navigation must be keyboard-accessible and focusable

**Collapsing controls**
- Secondary toolbars, filter bars, and action sets often need to collapse or scroll on small screens
- Define the priority of visible actions when space is constrained

## Component Behavior Across Widths

Different components require different responsive strategies:

| Component | Common responsive behavior |
|-----------|---------------------------|
| **Tables** | Horizontal scroll, card reflow, or column collapsing |
| **Cards** | Reflow from multi-column to single-column grid |
| **Forms** | Stack labels above inputs; adjust field widths |
| **Sidebars** | Collapse into drawer, accordion, or hidden panel |
| **Dialogs/Modals** | Full-screen on mobile; centered overlay on desktop |
| **Toolbars** | Collapse secondary actions into overflow menu |

Do not apply the same responsive strategy to every component type. Match the strategy to the component's use case.

## Overflow

**Horizontal overflow is always a defect unless explicitly required.**

Common causes:
- Fixed-width children inside fluid parents
- Long unbreakable strings (URLs, code, long words without `overflow-wrap`)
- Tables without an overflow strategy
- Images without `max-width: 100%`
- Absolute/fixed positioned elements

Debugging overflow:
1. Add `outline: 1px solid red` to suspect elements temporarily
2. Check `min-width` constraints on flex/grid children (`min-width: 0` is frequently needed)
3. Inspect for any element with a hard-coded `width` wider than the viewport

## Design Workflow

1. Understand the content requirements and interaction model.
2. Inspect the project's existing responsive conventions (breakpoint values, container widths, grid patterns).
3. Identify the most constrained layout that must work.
4. Establish fluid base structure using relative units and intrinsic sizing.
5. Define breakpoints only where the layout genuinely breaks.
6. Implement responsive typography using `clamp()` or breakpoint-specific scale.
7. Handle navigation and component state changes at key widths.
8. Check for and eliminate horizontal overflow.
9. Review intermediate viewport widths — not just the breakpoint snap-points.
10. Verify with realistic content lengths, not just short placeholder text.

## Self-Review Checklist

Before considering responsive work complete:

- Does the layout work at 320px, 375px, 768px, 1024px, 1280px, and 1440px?
- Does anything break between those widths?
- Is there any horizontal overflow?
- Does the typography remain readable at all widths?
- Are touch targets at least 44×44px on mobile?
- Does navigation function at mobile sizes?
- Are all interactive states accessible at all widths (not just hover, which doesn't exist on touch)?
- Does the layout use the project's existing breakpoint conventions?

## Avoid

- Desktop layout simply shrinking linearly — content often requires structural changes, not just width reduction.
- Excessive breakpoints for every device size — let content drive breakpoints.
- Fixed pixel widths on components that must live in fluid parents.
- Horizontal overflow without an intentional overflow strategy.
- Touch targets smaller than 44×44px.
- `hover`-only interaction states — touch devices do not have hover.
- Duplicated desktop and mobile markup without a clear reason.
- Breakpoint-specific hacks that fix one width while breaking another.

## Examples

### Example: Card grid reflow without breakpoints
Use intrinsic responsive layout that reflows naturally:
```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  gap: var(--space-4);
}
```
This single rule handles all viewport widths without any media queries.

### Example: Reasoning about a sidebar
Rather than hiding the sidebar at mobile widths with `display: none`, consider: What does the sidebar contain? If it contains navigation, it must be accessible somehow at mobile — as a drawer, a bottom nav, or an inline collapsed section. "Hide it" is not a responsive strategy.

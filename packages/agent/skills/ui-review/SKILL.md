---
name: ui-review
description: Structured UI critique and evaluation for existing interfaces. Apply when asked to review, evaluate, audit, or assess an interface — not to build or modify it. This skill produces prioritized findings across visual hierarchy, layout, typography, color, components, responsive behavior, interaction states, accessibility, content, and visual genericness. Use it before implementing improvements to establish what matters most.
category: frontend
version: 1.0.0
---

# UI Review

## When to use
- Reviewing an existing interface and identifying what should be improved
- Auditing a page or component before a redesign or polish pass
- Identifying the highest-impact issues before a sprint or release
- Evaluating a newly implemented UI against its design intent
- Producing a prioritized list of findings for a team discussion

## When not to use
- Building new UI from scratch (use frontend-design instead)
- Fixing a specific broken interaction (use frontend-debugging instead)
- Implementing responsive layout improvements (use responsive-design instead)

## Instructions
- Review the interface as a product, not merely as code.
- Do not automatically modify files during a review — produce findings first.
- Prioritize findings by user impact, not by personal aesthetic preference.
- Ground every finding in a specific observation: where the issue occurs, what the effect is, why it matters.
- Distinguish between problems that impair usability and those that are polish opportunities.
- Do not invent component locations or file paths without inspecting the actual codebase.

## Core Principle

A UI review evaluates whether the interface serves its users effectively.

Before reviewing visual aesthetics, understand:
- What is this interface for?
- Who uses it?
- What must they accomplish?
- What is the primary action or decision?

These answers determine what hierarchy problems matter and which visual choices are appropriate.

## Review Workflow

1. Understand the product and page purpose — what is this interface for?
2. Inspect the design system: existing components, tokens, conventions.
3. Read relevant component implementations.
4. Understand the primary user tasks.
5. Review visual hierarchy.
6. Review layout and spatial composition.
7. Review typography.
8. Review color.
9. Review responsive behavior.
10. Review interaction states.
11. Review accessibility basics.
12. Review content quality.
13. Identify visual genericness where it harms the product.
14. Consolidate findings by priority.
15. Produce structured output.

Do NOT edit files during review. If the user requests fixes after review, use FeCode's normal write tools and approval flow.

## Review Area: Visual Hierarchy

Evaluate:
- **Primary action clarity**: Is the most important action visually dominant?
- **Information hierarchy**: Does the layout communicate what matters most?
- **Typography hierarchy**: Do heading, subheading, body, and label roles create clear differentiation?
- **Visual weight**: Does emphasis land on meaningful content, or is everything equally prominent?
- **Scanability**: Can a user quickly orient themselves and find what they need?

Questions to answer:
- What does a user see first? Is that the right thing?
- Are there elements competing for attention that should not?
- Does anything important get buried in visual noise?

## Review Area: Layout and Spatial Composition

Evaluate:
- **Alignment**: Are elements consistently aligned on a grid?
- **Spacing**: Is spacing consistent? Does it communicate groupings correctly?
- **Grouping**: Do related elements appear proximate? Do unrelated elements have adequate separation?
- **Container width**: Is body content constrained to a readable width, or is it full-bleed on wide screens?
- **Density**: Is the layout density appropriate for the use case (dashboard vs. reading view vs. form)?
- **Rhythm**: Is there consistent vertical rhythm through the page?

## Review Area: Typography

Evaluate:
- **Readability**: Can all text be comfortably read at its current size and contrast?
- **Hierarchy**: Do heading levels create meaningful visual differentiation?
- **Line length**: Is body text constrained to a readable measure (roughly 55–80ch)?
- **Weight usage**: Is font weight used to create hierarchy, or is it decorative?
- **Size appropriateness**: Are secondary/caption/label sizes legible at 100% zoom?
- **Consistency**: Is the same typographic role expressed consistently across the interface?

## Review Area: Color

Evaluate:
- **Semantic meaning**: Do colors communicate their intended meaning (error red, success green, primary action)?
- **Contrast**: Is text readable on its background? (WCAG AA minimum)
- **Accent discipline**: Are accent colors used purposefully, or scattered decoratively?
- **Surface hierarchy**: Does background → surface → elevated surface create clear depth?
- **Design token consistency**: Are arbitrary hex values appearing where design tokens should be used?
- **Dark mode consistency**: If dark mode is present, do colors maintain their semantic meaning?

## Review Area: Components

Evaluate:
- **Consistency**: Do similar UI patterns use the same components?
- **Reuse**: Are existing primitives (Button, Card, Input) used rather than re-implemented?
- **Duplication**: Are there multiple implementations of the same visual component?
- **Unnecessary complexity**: Are any components over-engineered for their actual use?
- **Component boundaries**: Do components have coherent, single responsibilities?

## Review Area: Responsive Behavior

Evaluate:
- **Narrow viewport**: Does the layout function at 375px?
- **Intermediate widths**: Does anything break awkwardly between breakpoints?
- **Wide screens**: Is content meaningfully constrained on very wide viewports?
- **Horizontal overflow**: Is there any unexpected horizontal scrolling?
- **Navigation**: Does navigation function correctly at small sizes?
- **Content wrapping**: Does text wrap gracefully, or does it truncate unexpectedly?

## Review Area: Interaction States

Evaluate whether all interactive elements have defined, visible states:

| State | Present | Distinct | Accessible |
|-------|---------|----------|------------|
| hover | ? | ? | ? |
| focus-visible | ? | ? | ? |
| active/pressed | ? | ? | ? |
| disabled | ? | ? | ? |
| loading | ? | ? | ? |
| error | ? | ? | ? |
| success | ? | ? | ? |
| empty | ? | ? | ? |

A UI where only `hover` is styled is incomplete.

## Review Area: Accessibility Basics

Evaluate (do not duplicate the full accessibility skill):
- **Semantic HTML**: Are interactive elements real buttons and links?
- **Keyboard access**: Can the primary interaction be completed without a mouse?
- **Visible focus**: Is `:focus-visible` styled and visible?
- **Contrast**: Does text pass WCAG AA contrast ratios?
- **Labels**: Do form fields and icon buttons have accessible labels?
- **Color-only communication**: Is any state communicated by color alone, with no other indicator?

For deeper accessibility evaluation, pair this review with the accessibility skill.

## Review Area: Content Quality

Evaluate:
- **Labels**: Are labels specific and action-oriented, or vague ("Submit", "Click here")?
- **Placeholder content**: Is any placeholder text visible in the interface?
- **Realistic content assumptions**: Is the layout tested with realistic content lengths?
- **Empty states**: Are empty states designed, or do they leave a blank void?
- **Error states**: Do error messages explain what happened and what to do?
- **Long content**: Does the layout handle long names, descriptions, or list items gracefully?

## Review Area: Visual Genericness

Look for patterns that indicate the interface could belong to any product:

- Cards used for every content type regardless of appropriateness
- Hero sections with centered headline, subtext, and two buttons on every page
- Uniform rounded corners regardless of brand personality
- Gradients applied without product purpose
- Glassmorphism or blur effects used decoratively
- Decorative blobs, particles, or abstract shapes
- Every section wrapped in a card, inside another card
- Bento grids with unrelated icons as content substitutes
- Repetitive section structure repeated across multiple pages

**Evaluate whether each pattern serves the product, not whether it is fashionable.**

Some of these patterns are legitimate for specific products and design directions. Flag them only when they appear mechanical rather than deliberate.

## Finding Severity Levels

Organize findings by user impact:

### Critical
Problems that materially impair the user's ability to accomplish their primary task.

Examples: Inaccessible interactive element, broken form validation, unreadable text contrast, layout collapse at target viewport.

### High
Significant problems that reduce trust, comprehension, or efficiency without blocking the primary task.

Examples: Missing interaction states, unclear hierarchy hiding important actions, inconsistent component usage, readable but poor typography hierarchy.

### Medium
Polish and consistency issues that reduce the interface's quality without direct functional impact.

Examples: Spacing inconsistencies, missing empty states, design token violations, minor typography inconsistencies.

### Low
Minor improvements with small user impact.

Examples: Wording improvements, hover animation polish, minor visual alignment corrections.

## Finding Format

Each finding should ideally include:
- **Issue**: What specifically is wrong
- **Location**: Where it occurs (component name, page section) — only assert specific file paths after inspecting them
- **Why it matters**: What user impact this has
- **Suggested direction**: What kind of fix would address it (not necessarily exact implementation)

Do not fabricate locations. If you have not read the relevant file, say "in the [ComponentName] component area" rather than inventing a file path.

## Self-Check Before Producing Findings

- Have you understood what this interface is actually for?
- Are your findings grounded in the interface's purpose, not generic UI preferences?
- Have you separated functional problems from aesthetic preferences?
- Have you prioritized by user impact, not by what is easy to fix?
- Have you avoided recommending a redesign when the user asked for a review?

## Avoid

- Automatically editing files during review — produce findings and let the user decide what to fix.
- Reporting every finding as Critical — prioritize ruthlessly.
- Asserting exact file paths without inspecting the actual codebase.
- Flagging valid design choices as problems simply because they are not your preference.
- Suggesting a full redesign when specific targeted improvements were requested.
- Producing generic findings that could apply to any interface — ground them in this specific product.

## Examples

### Example: Grounded hierarchy finding

Generic (unhelpful): "The visual hierarchy needs improvement."

Grounded: "The 'Export' action and the 'Delete' action appear at the same visual weight. Delete is a destructive action that users should approach deliberately; its current prominence may cause accidental triggering. Consider reducing its visual weight (ghost/outline variant) relative to the primary Export action."

### Example: Distinguishing problem from preference

"The rounded corners feel too soft" is a preference.

"The border-radius on these cards (24px) is inconsistent with all other components in the application (8px), creating visual fragmentation" is a grounded finding.

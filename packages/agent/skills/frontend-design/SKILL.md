---
name: frontend-design
description: Professional frontend design methodology for creating, modifying, and polishing user interfaces. Apply when creating new pages or components, redesigning existing interfaces, implementing UI from product requirements, improving visual quality, or working on responsive layout. This skill teaches design thinking, visual hierarchy, typography, color, spatial composition, interaction design, and how to avoid generic AI-generated UI in favor of deliberate, product-appropriate interfaces.
category: frontend
version: 2.0.0
---

# Frontend Design

## When to use
- Creating new UI pages, views, or components
- Modifying or redesigning an existing interface
- Implementing UI from a design brief or written requirements
- Polishing visual quality of an existing interface
- Responsive layout work
- Improving interaction states or motion

## When not to use
- Pure backend or API work with no UI surface
- Database schema or server-side logic work
- Writing tests unrelated to UI behavior

## Instructions
- Make deliberate design choices appropriate to the product — never default to the nearest generic template.
- Before writing any UI code, understand the product, its users, and the primary task the interface must accomplish.
- When modifying an existing interface, preserve its design language unless explicitly asked to redesign it.
- When creating new UI in an existing project, inspect and reuse existing design tokens, components, and conventions.
- Design for the user's primary task first; everything else is supporting.
- Every visual decision must earn its place — eliminate anything decorative without purpose.

## Design Thinking

Before writing any UI code, reason through these questions:

1. **What is this interface?** A dashboard, a form, a detail page, a list view, a marketing page?
2. **Who uses it?** A consumer in a hurry, a professional doing analytical work, an administrator configuring a system?
3. **What is the primary task?** The single most important thing a user must be able to do efficiently.
4. **What information is most important?** Establish a hierarchy — not all elements deserve equal visual weight.
5. **What should the user notice first?** Design entry points deliberately.
6. **What visual personality fits the product?** Technical tools feel different from consumer apps, which feel different from luxury products.
7. **What existing design language must be preserved?** For existing projects, this question overrides all others.

Design is a series of deliberate choices. Make those choices consciously rather than generating the first plausible layout.

## Existing Products vs New Interfaces

### Modifying an existing interface

**The existing design system is the source of truth.**

Before implementing anything:
- Read existing components in the project
- Identify design tokens (colors, spacing, radius, shadows, typography)
- Understand existing layout patterns and grid conventions
- Examine interaction patterns (hover, focus, active states)
- Identify component naming conventions

Then implement the change **within** that language. Do not introduce new color palettes, new radius conventions, or new spacing scales. Do not "improve" a product's aesthetic unless the user explicitly requests a redesign.

Signs you are drifting from the existing system:
- You are introducing a new color not present in existing components
- You are using radius values unlike anything else in the project
- Your component has a completely different spacing density than its neighbors

### Creating a new interface

When the project is genuinely new or the user requests a redesign, establish a deliberate visual direction.

Possible directions (choose what fits the product):
- **Minimal** — whitespace-driven, restrained, high readability
- **Editorial** — strong typographic hierarchy, expressive layouts
- **Technical** — dense, information-rich, precise
- **Utilitarian** — clarity and efficiency above expression
- **Playful** — expressive color, rounded forms, energetic
- **Luxury** — restrained, premium materials, deliberate pacing
- **Industrial** — structured, mechanical, systematic

Choose a direction. Then build everything within it consistently. Do not blend incompatible directions accidentally.

## Typography

Typography is the primary instrument of visual hierarchy.

**Hierarchy**
- Establish a clear scale: display/heading/subheading/body/caption/label
- Not every page needs every level — use what the content requires
- Contrast between levels creates hierarchy; too-similar sizes create visual noise

**Display and body roles**
- Display type draws attention and communicates personality
- Body type must be legible at length — optimize for readability over expression
- Do not use display treatments for body-length content

**Weight, leading, and tracking**
- Use weight to differentiate hierarchy, not decoration
- Line height for body text: 1.5–1.7 for comfortable reading
- Line height for headings: 1.1–1.3 for tight, assertive display
- Tight letter-spacing on large display type typically improves appearance
- Loose letter-spacing on small caps/labels can improve legibility

**Measure**
- Body text reads best between 55–80 characters per line
- Full-width body text on wide screens is almost always wrong — constrain it

**Existing projects**
- Use the project's established type scale, not a new one
- If the project already uses Inter or Roboto, do not introduce a new typeface
- If the project has no clear type system, establish one and be consistent

## Color

**Semantics before aesthetics**
Understand what colors mean in context before choosing them:
- Primary: the interface's brand/action color
- Secondary: supporting actions or alternative emphasis
- Semantic: success, warning, error, info
- Surface hierarchy: background → surface → elevated surface
- On-colors: text/icons placed on each surface

**Contrast**
- Body text on backgrounds must meet WCAG AA contrast at minimum
- Critical interactive elements must be distinguishable without color alone

**Accent discipline**
- Use accent colors for actions, not decoration
- More than two or three accent colors in one interface is usually noise

**Design tokens**
- Prefer existing CSS variables or design tokens over arbitrary hex values
- Introduce new tokens only when filling a genuine gap

**Dark mode**
- Surface hierarchy inverts in dark mode — darker isn't always correct
- Avoid pure black surfaces; slightly elevated grays produce better depth

## Spatial Composition

Space communicates relationships. It is not filler.

**Proximity**: elements that belong together should be close; elements that are separate should breathe
**Alignment**: consistent grid alignment creates calm; misalignment creates visual tension
**Rhythm**: consistent vertical rhythm through spacing scales creates cohesion
**Density**: match density to use case — dashboards can be dense, reading views need space
**Grouping**: use space and visual weight before reaching for borders and dividers

**Spacing scale**
Use the project's spacing scale (or establish one: 4px base unit, multiples thereof). Avoid arbitrary pixel values that break rhythm.

**Container width**
- Reading content: constrain to ~65–75ch
- Data-dense interfaces: allow wider containers
- Full-bleed elements need intention — not everything should fill the viewport

**Grid and flex**
Use CSS Grid for two-dimensional layout; Flexbox for one-dimensional alignment. Do not reach for absolute positioning when flow-based layout is cleaner.

## Components

**Inspect before building**
Before creating a new component, search the codebase for:
- Existing components that may already serve the purpose
- Existing primitives (Button, Card, Input, Modal) that should be composed
- Existing patterns for how similar UI is assembled

**Composition over creation**
Prefer composing existing primitives over building new ones from scratch. Every new primitive must be maintained.

**Component size**
- Components with more than three or four major responsibilities are usually too large
- Extract sub-components when a section has independent visual logic
- Do not extract purely for abstraction's sake when it adds no clarity

**Avoid duplication**
Do not create a `PrimaryButton` alongside an existing `Button` with a `variant="primary"` prop. Understand the existing component API first.

## Responsive Design

Think about the interface's behavior at every width, not just at defined breakpoints.

**Layout strategy**
- Start from the most constrained layout the content requires
- Define breakpoints where the layout naturally breaks, not at arbitrary device widths
- Fluid layouts that adapt gracefully often require fewer breakpoints than rigid ones

**Fluid width vs fixed columns**
- Let containers grow to a max-width, then center
- Avoid pixel-fixed widths on components that must live in fluid parents
- Grid columns should collapse meaningfully at smaller sizes

**Typography and spacing respond to viewport**
- Headings that work at 1400px may be overwhelming on mobile — scale them
- Spacing density can increase at wider viewports
- Use relative units and clamp() for fluid typographic scaling

**Navigation at small sizes**
- Horizontal nav bars often cannot survive narrow viewports — plan mobile navigation early
- Collapsed navigation patterns (hamburger, drawer, bottom bar) each have trade-offs; choose deliberately

**Overflow**
- Horizontal overflow is almost always a bug, not a design choice
- Tables and data-dense elements need explicit overflow strategies on small screens

**Between breakpoints**
Test by resizing gradually, not just by snapping between sm/md/lg. Fix anything that breaks awkwardly in between.

## Interaction Design

Every interactive element has multiple states. Design all of them.

**Required states for interactive elements**
- `hover` — shows the element is actionable
- `focus-visible` — must be visibly distinct for keyboard users (do not remove outlines)
- `active` / `pressed` — confirms the action is being triggered
- `disabled` — communicates unavailability; reduce opacity or alter appearance
- `loading` — prevents double submission and communicates progress
- `error` — communicates failure clearly, without blame
- `success` — confirms completion

**Additional states as needed**
- `selected` / `checked` / `on` for toggles and selections
- `empty` — design empty states, not blank voids
- `skeleton` / `loading placeholder` — prefer structural loading over spinners for content-heavy surfaces

Hover is not the only interaction state. A button that looks identical when focused, hovered, and pressed is incomplete.

## Motion

Motion should communicate, not decorate.

**Purposeful transitions**
- Transitions should reinforce spatial relationships (drawers slide, modals appear from their trigger, lists animate in sequence)
- State changes benefit from transitions that indicate what changed and why

**Duration and easing**
- Most UI transitions: 150–300ms
- Complex motion (modals, page transitions): 300–500ms
- Ease-out for elements entering; ease-in for elements leaving; ease-in-out for state transitions

**Reduced motion**
- Always respect `prefers-reduced-motion`
- Provide no-animation fallbacks; never disable reduced-motion support

**What to avoid**
- Animation that fires without user intent
- Decorative animation that competes with content
- Excessive bounce, spin, or particle effects in productivity interfaces
- Animation that delays the user from completing their task

## Content as Design

Content is not a placeholder. It is the interface.

**Copy**
- Labels, headings, and button text should be specific, not generic ("Save changes" not "Submit")
- Error messages should explain what went wrong and what to do next
- Empty states should explain the situation and offer a next action

**Content length realism**
- Design for realistic content — not just the 15-character happy-path name
- Test with long names, long descriptions, many list items, empty lists
- Define truncation behavior explicitly (ellipsis, clamping, expand)

**Localization considerations**
- Text expands significantly in many languages (German, Finnish); build layouts that tolerate it
- Avoid fixed-width containers sized tightly to English text

## Basic Accessibility

(The dedicated accessibility skill contains deeper guidance.)

Minimum requirements regardless of design style:
- Use semantic HTML elements for their intended purpose
- All interactive elements must be keyboard-reachable and operable
- Visible `:focus-visible` styles on all interactive elements — do not remove them
- Text must meet WCAG AA contrast ratios on its background
- Images must have meaningful alt text; decorative images use `alt=""`
- UI actions must not depend solely on color to communicate state
- Respect `prefers-reduced-motion` in all animations and transitions

## Avoiding Generic AI-Generated UI

The most common failure mode of AI-generated frontend code is visual genericness. The interface looks assembled from an anonymous template rather than designed for a specific product.

**Signs of generic AI UI to detect and correct**
- Interchangeable card grids filling every surface regardless of content type
- Hero sections with a centered headline, subtext, and two buttons — used when not appropriate
- Excessive rounded corners applied uniformly regardless of brand personality
- Purple/blue gradient text fills on headings with no product reason
- Glassmorphism effects applied decoratively without contributing to hierarchy
- Decorative blobs, particles, or abstract shapes placed behind content
- Every section wrapped in a card, inside another card, inside another card
- All text set in the same weight, creating a flat hierarchy
- Gradients that exist because "gradients feel modern," not because they communicate anything
- Bento grids populated with unrelated icons as substitutes for actual content

**The principle**
These are failure modes, not absolute prohibitions. Gradients, rounded corners, and cards are legitimate design tools. The failure is using them automatically, without a product reason.

The corrective question: *Why does this specific product need this specific visual treatment?*
If the answer is "because it looks good" without connection to the product — reconsider it.

## Design Workflow

1. **Understand the request** — What specifically is being created or changed? What outcome is the user trying to achieve?
2. **Inspect the existing project** — Read existing components, design tokens, colors, spacing, typography. For existing projects, this step determines most of what follows.
3. **Identify the primary task** — What must the user be able to do? Design around that.
4. **Determine visual direction** — For existing projects: maintain it. For new interfaces: choose deliberately.
5. **Establish structure** — Layout, information hierarchy, component breakdown.
6. **Implement structure** — Semantic HTML, layout, component composition.
7. **Implement visual styling** — Typography, color, spacing, depth.
8. **Implement responsive behavior** — Test from narrow to wide; fix what breaks between breakpoints.
9. **Implement interaction states** — All states for all interactive elements.
10. **Implement motion** — Where purposeful; none where not.
11. **Self-review** — Run the checklist below before considering the work complete.
12. **Verify** — Run project checks; review actual output.

## Self-Review Checklist

Before considering UI work complete:

- Does this interface feel specific to this product, or could it belong to any SaaS?
- Does the visual hierarchy communicate the intended priority of information?
- Is there anything decorative without purpose?
- Are spacing and alignment consistent throughout?
- Does the layout work at narrow and wide viewports, and between them?
- Are all interactive states complete (hover, focus, active, disabled, loading, error)?
- Does this preserve the existing design system, or does it introduce inconsistencies?
- Does it feel like a coherent interface rather than a collection of independently styled components?

## Verification

After implementing UI changes:
- Inspect the actual rendered output or diff carefully
- Run any existing visual or component tests in the project
- Run the project's type and lint checks
- Verify responsive behavior by considering the layout at multiple widths
- Confirm interaction states are present by reviewing the implementation

## Examples

### Example: Dashboard primary action

**Generic approach:**
Create a dashboard with 12 metric cards in a responsive grid.

**Better approach:**
Identify the dashboard's primary decision. Design the layout hierarchy around that one thing. Surface the most actionable metric prominently. Use supporting data as secondary context. The number of cards follows from the content, not from filling a grid.

### Example: Modifying an existing component

**Wrong approach:**
The component uses gray-100 for its background. The AI decides to "improve" it with a subtle gradient and more rounded corners, introducing design system inconsistency.

**Correct approach:**
Read the existing Button, Card, and Input components first. Match their background, radius, shadow, and spacing conventions exactly. The new component is invisible relative to the design system — which is correct.

## References
- Design System: Check project source for existing tokens and component conventions before writing new styles

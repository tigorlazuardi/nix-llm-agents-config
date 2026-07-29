---
name: frontend-design
description: Single entry point for all frontend design work — structure (design as little as possible, Gestalt grouping, hierarchy, design-system tokens, white space) fused with distinctive production-grade aesthetics (bold direction, typography, motion, anti-generic styling), plus routing to the specialized UI skills. Use whenever building, styling, or reviewing web components, pages, dashboards, landing pages, or any UI; when designing a section from scratch; when a design feels cluttered, unscannable, flat, or generic.
---

# Frontend Design

One door for frontend work. Two halves fused: STRUCTURE first (scannability, hierarchy, restraint), then VISUAL CHARACTER (distinctive, anti-generic). Creativity = process, not moment — connecting existing ideas beats blank-slate invention.

## Routing — load specialized skills as the task demands

- `frontend-guidelines` — user's durable rules (light-mode default, library-first, feedback + error paths, testing-is-done). ALWAYS load; on any conflict with this skill, guidelines WIN (notably: default theme stays light regardless of aesthetic direction).
- `frontend-stack` — concrete React stack (Tailwind + shadcn/ui + Radix + Framer Motion). Load when building React UI.
- `ui-color-theming` — palettes, tokens, dark/light mode, HSL/OKLCH, CSS variables.
- `ui-spacing` — padding/margins/gaps, cramped layouts, button padding.
- `ui-depth` — flat UI, shadows, elevation, layering.
- `ui-responsive-layout` — flexbox vs grid, breakpoints, sidebars/headers.
- `ux-psychology` — onboarding, signup, forms, pricing, paywalls, drop-off.

Framework stance (user preference): USE established UI systems (shadcn/ui, Radix, Tailwind, etc.) — they cover a11y and edge cases hand-rolled CSS misses. Distinctiveness comes from tokens and polish on top, never from rebuilding primitives.

## Part 1 — Structure

### Design as little as possible

Don't start from header/structure/"how many sections". Ask: what's the key functionality / main selling point? (Often: heading + input + button.) Design that first; often it's all that's needed. Fewer colors, words, elements. More design ≈ uglier design.

### Gestalt — similarity + proximity

Brain processes the whole before details; design must be scannable in seconds. Group with shape, size, color, spacing. Similar-looking elements read as one group (also cheaper to implement); proximity defines layout. First goal: understandable as a whole.

### More white space than you think

Designer stares at one element — space feels excessive. User scans the whole page — space reads fine. Start with lots of spacing, remove until happy. Controlled density is allowed as a deliberate aesthetic choice, never as an accident.

### Design system = few tokens, picked early

- Spacing: values divisible by 4px, in rem (px ÷ 16). System = fast picking, context decides the value. Never design with lorem ipsum — spacing perfect for one card is disaster for another.
- Typography: ONE type scale. Line height inversely proportional to font size; generous line height doubles as vertical spacing between text elements. Don't center-align paragraphs or small text.
- Colors: dark + light for text/background + max two personality colors. Legibility over color psychology.
- Key elements first: two link styles + two button styles (primary/secondary) before any page design.
- Everything as variables/tokens.

### Hierarchy is everything

Emphasize what the user looks for FIRST (title/key value/primary action) via size, weight, color — start small. Often emphasis = DE-emphasizing competitors (drop secondary contrast) rather than boosting the target. Escalation: reduce competitor contrast → bump weight → bump size. Verify: zoom out — key element wins a 2-second scan? Semantic tags ≠ visual size: an h3 or p may render bigger than an h2 — context rules.

## Part 2 — Visual character

Before coding, commit to a BOLD aesthetic direction:

- **Purpose**: what problem, who uses it.
- **Tone**: pick an extreme — brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian…
- **Differentiation**: what makes this UNFORGETTABLE?

Intentionality, not intensity — bold maximalism and refined minimalism both work when executed with precision.

- **Typography**: distinctive, characterful fonts — never Arial/Inter/Roboto/system defaults. Pair a display font with a refined body font.
- **Color & theme**: cohesive; dominant colors with sharp accents beat timid evenly-distributed palettes. CSS variables throughout.
- **Motion**: high-impact moments over scattered micro-interactions — one well-orchestrated page load with staggered reveals; scroll-triggering; surprising hovers. CSS-only for HTML; Motion library for React.
- **Spatial composition**: asymmetry, overlap, diagonal flow, grid-breaking elements where the direction calls for it.
- **Backgrounds**: atmosphere over solid fills — gradient meshes, noise, geometric patterns, layered transparencies, dramatic shadows, grain.

NEVER: purple-gradient-on-white clichés, cookie-cutter layouts, converging on the same trendy font (e.g. Space Grotesk) across generations. Vary themes, fonts, aesthetics per context.

### Conflict rule (structure vs character)

Boldness goes to the FEW emphasized elements; restraint everywhere else — distinctive ≠ cluttered. Product UI: scannability/simplicity wins. Marketing/landing: aesthetics gets more rope. Match implementation complexity to the vision: maximalist = elaborate code; minimalist = precision and subtle detail.

## Creative process (when stuck or starting fresh)

1. **Basics** — the rules above. Books: Atomic Design, Refactoring UI.
2. **Inspiration** — study top-tier real products for the SPECIFIC section being built; note what works as a user.
3. **Incubation** — form ideas, step away, revisit; better ideas surface.
4. **Ship + iterate** — don't fall in love with v1. Show colleagues, then users; adjust. Finishing something mediocre beats endless planning.

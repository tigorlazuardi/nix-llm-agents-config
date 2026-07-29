---
name: ui-responsive-layout
description: Build responsive layouts that work from smartphone to 4K — box/parent-child thinking, rows-and-columns decomposition, flexbox vs grid decision rule, flex-grow/shrink/basis mechanics, media queries, position property, Tailwind responsive utilities. Use whenever building or fixing page layout, making a UI responsive, choosing between flexbox and grid, debugging wrapping/overflow/empty-space issues, or handling sidebars/headers across breakpoints.
---

# Responsive Layout

Everything on a page is a box; responsive design = dynamically moving boxes into rows and columns as width changes. Source: Sajid.

## Rule 1: think in boxes (parent-child tree)

Before HTML, sketch the family tree top-down: which parent, how many immediate children. Children count = visual columns/groups, not elements ("header has three children" because three visual columns). Wrong nesting = unfixable CSS later. Name boxes descriptively — easier debugging, no naming conflicts.

## Rule 2: every design = rows and columns

Column count grows with screen width; boxes flow into them. Base recipe: `display: flex` + `gap` + `flex-wrap: wrap` on the parent = technically responsive already.

## Flexbox behavior: grow / shrink / basis

Defaults: `flex: 0 1 auto` (no grow, shrink allowed, start at content size).

- `flex-grow` — fill leftover space. Proportional, not boolean: `flex-grow: 2` takes 2× share; use to keep a chart dominant over sibling stats.
- `flex-shrink: 0` — refuse to shrink below basis.
- `flex-basis` — starting size. `auto` = content size (gotcha below); `0` = distribute all space purely by grow ratios.
- Most-used flexible combo: `flex: 1 1 auto` (start natural size, grow and shrink).
- **Gotcha**: siblings with `flex-grow: 1` still grow UNEQUALLY when basis is `auto` — algorithm gives leftover to the bigger child. Fix: set a fixed `flex-basis` for equal growth.

## Flexbox vs grid

Default to flexbox for everything until you specifically need rigid structure. Flex = children have freedom (grow/shrink/wrap to fit). Grid = parent dictates (equal-size tracks regardless of content).

- Equal-width cards at any column count → grid: `grid-template-columns: repeat(auto-fit, minmax(min(400px, 100%), 1fr))` — `min()` prevents mobile overflow, `auto-fit` handles 1/2/3-column automatically.
- Flexible content-driven rows → flex + wrap + `flex: 1 1 auto`.
- `justify-content: space-between` distributes leftover space between children — headers' best friend.

## Media queries

For behavior too complex for flex/grid alone: hide elements (`display: none`), stop growth (`flex-grow: 0`), reposition (`margin-*: auto`). Put ALL media queries at the END of the stylesheet — cascade otherwise silently overwrites them.

## Position

- `static` default (normal flow) → `relative` same flow + offsets unlocked → `absolute` removed from flow, anchored to nearest non-static ancestor → `fixed` viewport-anchored, ignores scroll → `sticky` normal flow until it hits its offset, then pins.
- **Gotcha**: `absolute` child needs `position: relative` on the intended parent, else it anchors to the page.
- **Gotcha**: `sticky` inside a flex parent needs `align-self: flex-start` (else stretched full height = never sticks).
- Sidebar pattern: desktop = flex child in flow; mobile = `position: absolute` overlay on top of content (media query), so toggling doesn't reflow the page. Sticky header `top: 0`; sticky sidebar `top: <header height>`.

## Tailwind usage

- Base recipe: `flex flex-wrap gap-4` on parent.
- Grow/shrink/basis: `grow` (=1), `grow-0`, `shrink-0`, `basis-auto`/`basis-0`/`basis-64`; combos `flex-1` (`1 1 0%` — equal columns), `flex-auto` (`1 1 auto` — natural size, flexible), `flex-none`. Proportional grow: `grow-[2]`.
- Breakpoints are mobile-first `min-width`: base classes = mobile, `md:`/`lg:` = wider. Stack→row: `flex-col md:flex-row`. Hide on mobile: `hidden md:block` (or reverse `md:hidden`).
- Auto-fit card grid: `grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(400px,100%),1fr))]`; simpler fixed steps: `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`.
- Header: `flex items-center justify-between gap-4`; middle search grows `grow max-w-md`, mobile `grow-0 ml-auto`.
- Position: `relative` on container, `absolute inset-y-0 left-0` overlay sidebar, `sticky top-0 self-start` (self-start = the flex-parent sticky fix), `fixed`.
- Container queries when component (not viewport) width matters: `@container` on parent, `@md:flex-row` on children.

## Workflow

1. Sketch layout per breakpoint FIRST (mobile 1-col, desktop n-col, what happens to sidebar?) — retrofitting responsiveness costs a rebuild (sunk cost trap).
2. Draw parent-child tree, top-down.
3. Build desktop with flex-default/grid-when-rigid.
4. Media queries (or responsive prefixes) for what layout tools can't express.
5. Test extremes: narrow phone AND ultrawide.

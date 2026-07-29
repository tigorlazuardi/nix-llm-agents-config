---
name: ui-spacing
description: Systematic UI spacing — rem-based 0.25 increments, group-vs-separate hierarchy, start-big rule, optical weight for button padding, Tailwind spacing-scale mapping. Use whenever setting padding, margins, gaps, or layout spacing in a UI; when a design looks cluttered, cramped, or unbalanced; when picking button padding or icon-text gaps; or when reviewing a layout for spacing consistency.
---

# UI Spacing System

Spacing's job: group related elements, separate distinct ones. Users navigate by gaps, not borders. Source: Sajid.

## The system

Use `rem`, not px — spacing scales with font size (1 rem = 16px, most UI text is 1 rem). Increment by 0.25 rem (4px). Three values cover most gaps/margins/padding: **0.5 rem** (group closely related), **1 rem** (padding, button groups), **1.5–2 rem** (separate sections). Same values double as optically balanced border radii (1 rem padding pairs with these radii).

## Rule 1: consistency beats correctness

Wrong-but-consistent spacing still reads okay; inconsistent spacing looks cluttered even with "right" values. Fix consistency first, then tune.

## Rule 2: start big, decrease

Never start at 0.5 rem and grow — start at 1.5 rem and shrink if needed. Extra white space only helps readability; tight spacing actively hurts UX. (Designs get reviewed zoomed-in; slightly-too-much beats slightly-too-tight at real size.)

## Rule 3: inner < outer

Gap between icon and text inside a button MUST be ≤ the button's horizontal padding. Equal is acceptable; inner > outer never. Larger inner spacing only when elements serve different purposes (e.g., like/dislike pair spaced wider than each button's own padding — but each button still keeps inner < padding).

## Rule 4: optical weight — vertical padding smaller

Text has more visual noise horizontally (varying letter widths) than vertically (bounded by cap height + descenders). Equal padding makes buttons look bloated. Buttons: horizontal padding ≈ 2–3× vertical. Exception: stacks of vertical elements need real vertical padding (e.g., 1.25 rem both sides) to breathe.

## Tailwind usage

Tailwind's spacing scale is already this system: 1 unit = 0.25 rem, so the numbers map directly:

| rem | px | Tailwind |
| --- | --- | --- |
| 0.25 | 4 | `p-1` / `gap-1` |
| 0.5 | 8 | `p-2` / `gap-2` — group closely related |
| 0.75 | 12 | `p-3` / `gap-3` |
| 1 | 16 | `p-4` / `gap-4` — padding, button groups |
| 1.25 | 20 | `p-5` / `gap-5` |
| 1.5 | 24 | `p-6` / `gap-6` — separate groups |
| 2 | 32 | `p-8` / `gap-8` — separate sections |

Practical mappings:

- Core trio: `gap-2` inside groups, `p-4`/`gap-4` for padding and button rows, `gap-6`/`gap-8` between groups/sections.
- Optical-weight button: `px-4 py-2` (or `px-6 py-2` for wider) — never `p-4` on a text button.
- Icon+text button: `gap-2` inner with `px-4` outer keeps inner < outer.
- Matching radii: `p-4` pairs with `rounded-lg`/`rounded-xl`; `p-2` with `rounded-md`.
- Rows: `justify-between` instead of fixed gaps; primary action right.
- Prefer `gap-*` on flex/grid parents over per-child margins — one consistent value, no margin-collapse surprises.
- Stick to the scale — arbitrary values (`p-[13px]`) break the 0.25 rem rhythm; needing one usually signals a grouping problem, not a spacing problem.
- v4: scale derives from `--spacing` (0.25rem default) in `@theme` — change that one token to retune the whole rhythm.

## Workflow for fixing a layout

1. **Group.** Break each section into groups of closely related elements (title+description = one group; options = another; action buttons = another).
2. **Separate.** ≤ 1 rem inside groups (often 0.5), 1.5–2 rem between groups, ~2 rem between sections. Start generous (2 rem section padding), reduce if heavy (→ 1.5).
3. **Balance.** Equalize heights of siblings (short toggle next to tall inputs → set explicit height). Cards in a row → grid/flex for equal widths, outer gap ≈ inner padding. Horizontal rows → `space-between` over fixed gaps; primary action on the right.
4. **Verify at real size.** Zoom out to actual scale before judging "too much space".

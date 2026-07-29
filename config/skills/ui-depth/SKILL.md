---
name: ui-depth
description: Turn flat/boring UI into professional-looking via depth and layering — stacked lightness shades, two-part shadows (light top glow + dark bottom), inset shadows for recessed elements, elevation hierarchy, Tailwind shadow recipes. Use whenever a UI looks flat, boring, or lacks hierarchy; when styling cards, navs, dropdowns, radio groups, progress bars, or dashboards; when deciding shadows/elevation; or when everything blends together with no focus.
---

# UI Depth & Layering

Average → good design mostly = depth. Two-step process: (1) 3–4 shades of one base color, (2) shadows. Source: Sajid. Companion: ui-color-theming skill for the shade/variable system.

## Step 1: layer with lightness

Create 3–4 shades of the same base color (increase lightness ~0.1 per layer, OKLCH). Stack: darkest = page base, lighter = containers/cards, lightest = interactive/raised elements. Lighter = closer to user = more important. Side effect: lighter elements can DROP their borders — the shade difference does the separating.

## Step 2: two-part shadows

One flat shadow looks fake. Realistic elevation = light + dark combined:

- **Light part**: thin light border/glow/inset-highlight on TOP ("light from above").
- **Dark part**: darker shadow at BOTTOM.
- Levels: bump the pixel values a few px per level. Two levels cover most UIs; small shadows usually read more natural than big ones.

Recessed (opposite direction — element pushed INTO the surface): dark inset shadow on top + light inset shadow on bottom. Use for tables "deeper" than the page, progress-bar tracks, wells. Slightly darker background sells it further.

## Hierarchy workflow (fixing a flat layout)

1. Darken the page background one shade; main elements immediately pop.
2. Everything popping = nothing popping. De-emphasize: give secondary elements (tables, graphs) darker shades than primary cards — each layer distinct.
3. Shadow by importance: bigger shadow = more elevated = more attention. Recess background-ish elements with insets.
4. Selected/active states: lighter shade + small elevation shadow; also bump text/icon lightness or they look muted on the lighter surface.
5. Interactive elements get the lightest shade — they ARE the interface.
6. Hover: larger shadow on hover (strongest in light mode — never skip light mode, it's most users' default).
7. Gradients: subtle top-lighter linear gradient + light inner top shadow complement each other on buttons/dropdowns.

Use color + shadow VARIABLES so the whole system flips with dark/light mode.

## Tailwind usage

- Shades: theme tokens from ui-color-theming (`bg-bg-dark`, `bg-bg`, `bg-bg-light`); interactive elements `bg-bg-light`, page `bg-bg-dark`.
- Two-part shadow as one custom token in v4 `@theme` (box-shadow accepts comma list, inset first = top glow):

  ```css
  @theme {
    --shadow-raised: inset 0 1px 0 oklch(1 0 0 / 0.08), 0 2px 4px oklch(0 0 0 / 0.4);
    --shadow-raised-lg: inset 0 1px 0 oklch(1 0 0 / 0.1), 0 6px 16px oklch(0 0 0 / 0.5);
    --shadow-recessed: inset 0 2px 4px oklch(0 0 0 / 0.4), inset 0 -1px 0 oklch(1 0 0 / 0.06);
  }
  ```

  → `shadow-raised`, `shadow-raised-lg`, `shadow-recessed` utilities.
- One-off: arbitrary value `shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_2px_4px_rgba(0,0,0,0.4)]` (underscores = spaces).
- Hover lift: `shadow-raised hover:shadow-raised-lg transition-shadow`.
- Top-light gradient: v4 `bg-linear-to-b from-bg-light to-bg` (v3: `bg-gradient-to-b`).
- Alternative top glow: `ring-1 ring-white/10 ring-inset` composes with normal `shadow-*`.
- Selected state: `bg-bg-light shadow-raised` + brighter `text-*` on the selected item, plain `bg-bg` siblings.

## Sweet-spot rule

Diminishing returns: average → good = cheap (shades + shadows, few lines). Good → S-tier = expensive, barely visible. Like game graphics high vs ultra. Stop at "good" unless the element is the product.

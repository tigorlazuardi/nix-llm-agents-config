# UI color theming

Colors = shades. Three roles cover everything: neutrals (background, text, borders), one brand/primary (main actions, character), few semantic (states). Source: Sajid (tool linked in video description).

Parent policy wins: ship light mode by default, design both modes from start. Dark-first authoring below only derives shades. Both token sets defined before shipping; manual toggle defaults to light.

## Color format: HSL minimum, OKLCH preferred

Hex/RGB unreadable as palettes — near-identical shades look unrelated in code. HSL makes shade math obvious: hue 0–360, saturation 0–100%, lightness = the shade knob. OKLCH is better: lightness increments look perceptually natural (HSL dark/light extremes lose saturation). OKLCH ranges: L 0–1, C (chroma) 0–0.4 — UI work rarely needs above ~0.15–0.2, H 0–360. Tailwind v4 defaults to OKLCH.

## Neutral palette via lightness only

Set saturation/chroma to 0 → hue irrelevant, palette guaranteed neutral. Dark mode backgrounds: base L 0%, cards/surfaces 5%, raised/important 10%. Lighter = closer to user — reserve for important elements. Text: high-contrast shade for headings (NOT 100% — too harsh), muted shade for body.

## Light mode = flip, then adjust by eye

Start: `L_light = 100 − L_dark`. Then fix logic: light comes from top, so top elements lightest, base darkest. Naming: `--bg-dark` = always darkest shade, `--bg-light` = always lightest, in BOTH modes — never "dark-mode background". Text colors can't use that trick; name by role (`--text-heading`, `--text-muted`).

## CSS structure

Default theme in `:root`, other theme in a `body` class selector (JS toggle) or `prefers-color-scheme` media query. Define variables once; components only reference variables.

## Tailwind usage (v4)

Define tokens in `@theme` — generates utilities automatically:

```css
@import "tailwindcss";

@theme {
  --color-bg-dark: oklch(0 0 0);
  --color-bg: oklch(0.05 0 0);
  --color-bg-light: oklch(0.1 0 0);
  --color-text: oklch(0.96 0 0);
  --color-text-muted: oklch(0.76 0 0);
  --color-highlight: oklch(0.5 0 0);
  --color-border: oklch(0.4 0 0);
}
```

`--color-*` namespace → `bg-bg-dark`, `text-text-muted`, `border-border`, etc.

Theme flipping WITHOUT `dark:` prefix spam — semantic variables + `@theme inline`:

```css
:root {
  --bg-dark: oklch(0 0 0);
  /* ...dark mode values (default) */
}
.light {
  --bg-dark: oklch(0.92 0 0);
  /* ...light mode values, flipped + adjusted */
}

@theme inline {
  --color-bg-dark: var(--bg-dark);
  /* map each token */
}
```

Components just use `bg-bg-dark`; mode toggles by swapping one class on `<html>`. `@theme inline` required when token references another variable — else utilities capture the raw `var()` at the wrong scope. Reserve `dark:` variant for one-off exceptions, not the whole palette. v4 default palette is already OKLCH; custom tokens should be too.

## Depth polish (fixes flat/boring UI)

- **Border**: visible, not distracting. In light mode may need to blend with card background — separate `--border` variable per mode.
- **Gradient**: subtle, from background shades; shiny at top ("light from above"). Optionally reveal full gradient on hover.
- **Highlight**: lighter top border sells the light-from-above effect. In light mode bump its lightness way up or it reads as plain border.
- **Shadow**: needs alpha. Always combine one darker+shorter shadow with one lighter+longer — more realistic depth.

Hue + saturation come LAST: pick neutral structure first, then tint (warm vs cool) once contrast/gradient/shadow already work. Check primary/secondary in both modes — they carry buttons and hover states.

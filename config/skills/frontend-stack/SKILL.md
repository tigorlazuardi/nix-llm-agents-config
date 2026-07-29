---
name: frontend-stack
description: This user's concrete React frontend stack — React + Tailwind + shadcn/ui + Radix + Framer Motion, with TanStack Start for SSR, and Vitest + React Testing Library + MSW + Playwright for testing. Use when building React UI for this user and this stack is in play. This is the tool layer only; the durable principles (light-mode default, library-first, animation by context, mandatory feedback + error paths, testing-is-done) live in the `frontend-guidelines` skill — follow that too. The stack here may not apply to every project; the guidelines always do.
---

# Frontend stack (concrete tools)

This is the user's preferred React stack. It is the concrete tool layer; the principles behind it live in `frontend-guidelines` — read that for the "why" and the rules. This file just maps each principle to a specific tool. If a project uses a different stack, drop this file and keep the guidelines.

## Stack

- **Framework**: React
- **SSR / routing**: TanStack Start (Vite-based)
- **Styling**: Tailwind CSS
- **Components**: shadcn/ui (`npx shadcn@latest add <name>`)
- **Primitives / a11y**: Radix (bundled inside shadcn)
- **Animation**: Framer Motion (`motion/react`)

## Principle → tool mapping

| Guideline | This stack |
|---|---|
| Library-first: base components | shadcn/ui |
| Library-first: a11y primitives | Radix (via shadcn) |
| Library-first: animation | Framer Motion (`motion/react`) |
| Library-first: forms | react-hook-form + zod (`@hookform/resolvers`) |
| Library-first: tables | TanStack Table |
| Library-first: icons | lucide-react (shadcn default) |
| Library-first: charts | Recharts (shadcn charts) |
| Library-first: date/calendar | react-day-picker (shadcn calendar) |
| Light-mode default | no `dark` class on `<html>`; if `next-themes`: `defaultTheme="light"`, `enableSystem={false}`; keep `:root` light tokens active |
| Action feedback / error toast | `sonner` (`toast.error(...)`), `<Toaster />` mounted once at root |
| Field-level error | react-hook-form errors |
| Route crash / blank-screen guard | TanStack Start route `errorComponent` + `pendingComponent` |
| Distinctiveness | tweak shadcn tokens (radius, font, accent, spacing) + Framer Motion polish |

## Testing tools

| Layer | Tool |
|---|---|
| Unit / component | Vitest + React Testing Library |
| Interaction | @testing-library/user-event |
| Network mock | MSW (Mock Service Worker) |
| E2E / browser | Playwright |
| a11y | jest-axe (in Vitest) and/or Playwright axe |

Why: Vitest over Jest (shares Vite config, faster, no extra transform). Playwright over Cypress (free multi-browser, parallel, trace viewer). MSW because error/loading paths need easy simulation without a backend.

## Setup reference

```bash
# shadcn init (once) — pick light base color, CSS variables yes
npx shadcn@latest init
npx shadcn@latest add button dialog dropdown-menu form input sonner

# animation
npm i motion        # import from "motion/react"

# forms
npm i react-hook-form zod @hookform/resolvers

# testing
npm i -D vitest @testing-library/react @testing-library/user-event \
  @testing-library/jest-dom jsdom jest-axe msw
npm i -D @playwright/test && npx playwright install
```

- Vitest config: `environment: 'jsdom'`, setup file importing `@testing-library/jest-dom`.
- MSW: a `handlers.ts` with default success + per-test `server.use(...)` overrides for error/loading.
- Playwright: separate `e2e/` dir; keep unit and E2E test globs from overlapping.

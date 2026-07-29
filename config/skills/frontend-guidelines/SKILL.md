---
name: frontend-guidelines
description: General, stack-agnostic guidelines for building any frontend UI for this user. Use whenever building web components, pages, dashboards, forms, or any UI, regardless of framework. Enforces durable principles that hold even when the concrete stack changes — (1) light mode is the default theme (dark-by-default looks bad in demos), (2) library-first over rolling your own, (3) animation intensity tuned to context (user-facing exaggerate, backoffice-facing subtle), (4) every action gives feedback even when stubbed, (5) everything that can error has a visible error path even if it's only "not implemented", (6) testing is part of done. For the user's concrete React stack and exact tools, see the `frontend-stack` skill.
---

# Frontend guidelines (stack-agnostic)

Durable principles for any frontend this user builds. These hold regardless of framework. The concrete React stack lives in the `frontend-stack` skill; when that applies it maps each principle below to a specific tool. When it conflicts with the generic `frontend-design` skill, THESE win (notably: default theme stays light).

## 1. Light mode default, dark mode designed in

Dark-by-default looks bad in demos. Ship light as the default, always — but dark mode SUPPORT is part of the design, not an afterthought.

- Do not apply a dark class/theme on first render.
- If a theme system exists: default to light, and disable "follow system" — a dark-set laptop will otherwise force dark mid-demo.
- Define color tokens for BOTH modes from the start (see `ui-color-theming` for the flip workflow) — retrofitting dark onto hardcoded light values is a rewrite.
- Include a manual dark toggle; its default state stays light.

## 2. Library-first

Reach for an existing, solved library and tweak it. Do not roll your own when a primitive already exists.

- Base components, behavior/a11y primitives, animation, forms, tables, icons, charts, date pickers — all have mature libraries. Use them.
- Achieve distinctiveness by tweaking tokens (radius, font, color, spacing) and adding polish, not by rebuilding primitives.
- Only hand-roll when no library covers it or the library genuinely fights the design — and say so explicitly when you do.

## 3. Animation intensity by context

Always add animation, but tune intensity to the surface.

- **User-facing (marketing, landing, storefront, public app) — exaggerate.** Bold staggered page-load reveals, parallax, scroll-triggered sections, surprising hover states, spring physics, longer durations (~0.4–0.8s).
- **Backoffice-facing (admin, dashboard, internal tools) — subtle.** Fast and functional (~0.12–0.25s), gentle fades, small slides, layout transitions on data change, enter/exit on lists & modals. No parallax, no scroll theatrics — clarity over spectacle.
- Respect `prefers-reduced-motion` (reduce, don't kill).
- If the surface is ambiguous, ask — or default to subtle (safer for demos).

## 4. Every action has feedback (even stubs)

No dead clicks. Every interactive element must react, even when the logic behind it is a stub.

- Action with no backend yet → still show feedback: toast, spinner, disabled state, inline message. Never a silent no-op.
- Async actions show a pending state then a result state (success or error).
- Stub success → a clear "done (stub)" signal so the demo reads as alive.
- Forms validate and show field-level feedback immediately.

## 5. Every fallible thing displays its error (even "not implemented")

If an operation can error, it must have a visible error path — even if the only error today is "Not implemented yet" / "belum diimplement". This forces an error-display mechanism to exist from day one.

Pick the mechanism by scope:

| Scope | Mechanism |
|---|---|
| Transient action error (failed save/fetch on click) | toast |
| Inline / field-level | inline text under the field |
| Section / panel failed to load | error state block in that panel (message + retry) |
| Whole route / render crash | error boundary fallback (never a blank screen) |
| Empty / missing data (not an error, but handle it) | explicit empty state |

Rules:
- Stub an action → wire an error/notice on the not-yet-built branch, not a silent return.
- Every data fetch renders three states: loading, error, success (+ empty when a list can be empty).
- Error messages are human-readable; never dump a raw stack in the UI (log the stack, show a clean message).

## 6. Testing is part of done

Three layers, each a distinct job: unit/component, network-mocked integration, end-to-end browser. Plus an automated a11y check.

What must be tested (mirrors the rules above):
- Every stubbed action → feedback appears (no dead clicks).
- Every data fetch → all three states (loading, error, success; + empty), error/loading driven by a network mock.
- Every error path → the visible message renders.
- Light-mode default → no dark theme on initial render.
- Forms → field-level validation errors show.
- Key flows → one end-to-end happy path per major surface.

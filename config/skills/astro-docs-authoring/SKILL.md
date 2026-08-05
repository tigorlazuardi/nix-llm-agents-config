---
name: astro-docs-authoring
description: How to author plan/design/spec docs in the Astro + Starlight MDX dialect. Trigger when writing ANY plan/design/spec doc — SPEC.mdx, docs design docs (docs/src/content/docs/design/<yyyy-mm-dd>-<topic>.mdx), ADRs, slice docs (SCOPE/IMPLEMENTATION/TASKS/RESUME) — or when a planning skill (feature planning, workflow sweep, or grill-me output) writes its artifacts. Covers the MDX dialect (Aside, Tabs, Decision), the frontmatter schema with draft exclusion, code blocks, mermaid, and tables. Replaces the retired plandeck-authoring skill. For scaffolding the docs site itself, use astro-docs-setup.
---

# Authoring docs — Astro/Starlight MDX dialect

One dialect everywhere. Published design docs live in the repo's Starlight site (`docs/src/content/docs/design/`); working plans (`plans/**` — SPEC/TASKS/RESUME/slice docs) use the **same dialect** but are never published. Promoting a decision from a plan into `docs/` is copy-paste, no translation. Everything degrades gracefully to readable markdown on GitHub and in editors.

You write for a *human reader* (and, once published, for external RAG via llms.txt). Optimize for reading, not for re-parsing your own output.

## Locations

| Doc | Path | Published? |
|---|---|---|
| FASE-1 spec | `plans/<scope>/SPEC.mdx` | no |
| Slice docs (SCOPE/IMPLEMENTATION/TASKS/RESUME) | `plans/<scope>/<nnn>-<slice>/` | no |
| Design decision that outlives a scope / ADR | `docs/src/content/docs/design/<yyyy-mm-dd>-<topic>.mdx` | yes |
| Lesson-learnt report (error/quirk/incident) | `docs/src/content/docs/reports/<yyyy-mm>-<topic>.mdx` | yes — see `report-authoring` skill (structure, index, customSets) |

No docs site in the repo yet and a design doc needs a home → offer `astro-docs-setup` first; meanwhile the doc can start life in `plans/` and be promoted later.

## Plans and decision docs MUST be `.mdx`

Any document that captures decisions, warnings, or architecture defaults to `.mdx`. Plain `.md` only for prose notes with no decisions/callouts to record. An `.mdx` file with component tags still reads fine as plain text outside the site — the tags show literally, which is acceptable degradation, so never withhold `.mdx` out of viewer fear.

## Frontmatter schema

```mdx
---
title: Use SQLite FTS5 for search
description: One-line summary — REQUIRED, it feeds the llms.txt index.
status: accepted   # draft | accepted | superseded
date: 2026-07-07
draft: true        # ONLY while status: draft — excludes page from build AND llms.txt
---
```

- `title` + `description` required. `description` is what external RAG sees in the index — write it as the answer to "why would I open this doc".
- While drafting: `status: draft` **and** `draft: true` (Starlight-native — page drops out of the build and every `llms*.txt`; external RAG only ever sees final decisions).
- Finalize: `status: accepted`, **remove `draft: true`**.
- Overtaken: flip to `status: superseded`, keep it published (history preserved), link the successor in the first line.
- `plans/**` files carry the same frontmatter even though nothing builds them — promotion stays copy-paste.

## Components

Published docs import from `@astrojs/starlight/components`; `Decision` is local (`src/components/Decision.astro`, placed by astro-docs-setup):

```mdx
import { Aside, Tabs, TabItem, Steps, FileTree, Badge } from '@astrojs/starlight/components';
import Decision from '../../../components/Decision.astro';
```

In `plans/**` (never built) the imports are optional — tags degrade to literal text either way; skip imports there.

| Component | Props | Use for |
|---|---|---|
| `<Aside>` | `type` = `note`/`tip`/`caution`/`danger`, `title` | Highlighted note, risk, irreversible-step warning |
| `<Decision>` | `title`, `status` = `proposed`/`accepted`/`rejected`/`superseded` | Architecture decision record |
| `<Grid>` | `minWidth` (default `18rem`) | Side-by-side cells that reflow vertical when narrow AND always stack in print. **Print-friendly** — use this for reports instead of Tabs. (local, placed by astro-docs-setup) |
| `<Tabs>` + `<TabItem label>` | `label`, optional `icon` | Tabbed variants. **Design docs only** — NOT print-friendly (only the active tab prints). In reports use `<Grid>`. |
| `<Steps>` | wraps an ordered list | Sequential procedures |
| `<FileTree>` | wraps a nested list | Directory layouts |
| `<Badge>` | `text`, `variant` | Inline status markers |
| `<UiMock>` | `title`, `height` | Figma-style browser frame around inline HTML mock (local, placed by astro-docs-setup). Design docs only. |

### Print-friendly (reports) vs expressive (design docs) — the core split

Two doc classes, two rulebooks. Motto for reports: **Print Friendly.**

- **Reports** (`reports/**`) — a reader prints/saves them to PDF. So:
  - **No `<Tabs>`** — a tab hides content; only the open tab prints. Use `<Grid>` (side-by-side when it fits, stacks vertical when narrow or printing) for "A vs B" comparisons.
  - **Mermaid orientation for print** — see the Mermaid section: `flowchart TD` (vertical) by default so a long chain fits the page width; `LR` only for a genuinely short diagram.
  - Avoid content that only works by horizontal scroll — a print has no scrollbar. Keep tables narrow, code lines short.
- **Design docs** (`design/**`) — screen-first, expressiveness allowed. `<Tabs>`, `<UiMock>`, wide tables/diagrams are fine **as long as overflow is contained** in a scrollable element (`overflow: auto` box) so the page body never scrolls horizontally. Both-axis scroll inside a container is acceptable here; it is NOT in reports.

This split resolves the old HTMLBlock tension: rich/interactive/wide belongs in design docs; reports stay static and printable.

Record **every real architecture/design choice** as a `<Decision>` block — an ADR trail, not buried prose:

```mdx
<Decision title="Use SQLite FTS5 for search" status="accepted">
In-memory, zero external services, good enough for local doc sets.
</Decision>

<Aside type="caution" title="Irreversible">
This migration drops the legacy table. Take a backup first.
</Aside>
```

Old Plandeck dialect mapping (when touching legacy docs): `Callout` → `Aside` (`warn`→`caution`, `success`→`tip`), `CodeTabs` → `Tabs`/`TabItem`, `HtmlBlock` → drop.

## I/O examples — MANDATORY for every feature spec

Every feature spec (SPEC.mdx or design doc describing behavior) MUST contain an `### I/O examples` section — concrete input → output pairs, not prose. The shape follows the work:

| Work type | I/O example form |
|---|---|
| HTTP endpoint / API | Request + Response pair (headers + body), happy path AND at least one error case |
| Function / library | Call with real arguments → real return value (and thrown error case) |
| Event / queue consumer | Incoming payload → resulting side effect / emitted event |
| CLI | Invocation line → stdout/stderr + exit code |
| UI flow | User action → visible state change (pair with `<UiMock>`) |

Use `<Tabs>` with `Request`/`Response` (or `Input`/`Output`) labels, or paired fences. Keep the heading literally `### I/O examples` — it makes the section greppable and RAG-findable via llms.txt. Redact per telemetry tiers (secrets never appear, even in examples — use `<REDACTED>` placeholders).

```mdx
### I/O examples

<Tabs>
  <TabItem label="Request">
    ```http
    POST /api/v1/orders HTTP/1.1
    Authorization: Bearer <REDACTED>
    Content-Type: application/json

    {"product_id": "prd_123", "qty": 2}
    ```
  </TabItem>
  <TabItem label="Response 201">
    ```json
    {"order_id": "ord_456", "status": "pending", "total": 25000}
    ```
  </TabItem>
  <TabItem label="Response 422">
    ```json
    {"error": "insufficient_stock", "available": 1}
    ```
  </TabItem>
</Tabs>
```

## UI mocks — Figma-style preview

Spec touches UI → include an HTML mock inside `<UiMock>` (local component from astro-docs-setup). Write plain HTML + inline styles in the MDX body; Astro renders it live in the site and in `astro dev`:

```mdx
<UiMock title="Checkout — empty cart state" height="16rem">
  <div style="max-width:24rem;margin:auto;text-align:center;padding:2rem;">
    <p style="font-size:2rem;">🛒</p>
    <p><strong>Keranjang kosong</strong></p>
    <button style="padding:.5rem 1.25rem;border-radius:.5rem;">Mulai belanja</button>
  </div>
</UiMock>
```

- Keep mocks self-contained: inline styles or a `<style>` block inside the slot; no external assets (the site is static, and plans degrade to plain text).
- Preview workflow: a UI-bearing doc can live in the docs site with `draft: true` — renders in `astro dev`, excluded from publish until accepted. `plans/**` is never built, so promote (or temporarily draft-place) a spec when a rendered preview is needed for review.
- Rules of the frontend-design skill do NOT apply to mocks — a mock communicates layout/intent, not production styling.

## Code blocks

Starlight renders fences via Expressive Code. Language after the fence for highlighting. Useful meta:

````md
```go title="app/cron/usecase/sync_order.go" showLineNumbers startLineNumber=189
func (s *SyncOrder) publishOrderComplete(...) error {
    // real code copied from the repo — gutter starts at 189
}
```

```ts
// illustrative example — no title, no line numbers
const x = compute()
```

```diff lang="ts"
- old line
+ new line
```
````

- **Line numbers — the codebase-vs-example rule (REQUIRED):**
  - A snippet **copied from this repo's source** MUST carry line numbers anchored to the real file: `showLineNumbers startLineNumber=<first line>` **and** `title="<repo-relative path>"`. The reader can jump straight to the code. Use the line of the FIRST snippet line as `startLineNumber`.
  - An **illustrative / example** snippet (payload shapes, pseudo-code, "here's the pattern") does NOT need line numbers — omit `showLineNumbers` (they'd be meaningless / misleading).
  - Caveat for **abridged** real snippets (you elided middle lines with `// ...`): the gutter would lie past the first gap. Either keep it verbatim-contiguous so the gutter is honest, or drop `showLineNumbers` and put `path:line` in the `title` instead (e.g. `title="app/.../sync_order.go:189"`).
- **Setup**: line numbers need `@expressive-code/plugin-line-numbers` wired in `astro.config.mjs` with `defaultProps: { showLineNumbers: false }` (default OFF so examples stay clean; codebase snippets opt in per block). astro-docs-setup scaffolds this.
- `title="..."` when the snippet is a real file — instant context for the reader (path, and `:line` if abridged).
- Line highlighting: `{4, 7-9}` after the language; `ins={2}` / `del={5}` for change emphasis.

## Mermaid diagrams

**Prefer a diagram over a long textual description** of any flow / architecture / sequence — reach for ` ```mermaid ` before prose. Rendering is handled by the `astro-mermaid` integration (client-side, theme-aware, bundled — no CDN, no build browser), scaffolded by astro-docs-setup. GitHub also renders the fence, and llms.txt keeps the source.

**Orientation — print-friendly (matters for reports):**

- Default to **`flowchart TD`** (top-down, vertical). A vertical diagram fits the page width and prints cleanly no matter how long the chain gets.
- Use **`flowchart LR`** (left-right, horizontal) ONLY for a genuinely short diagram (≈2–4 nodes) that fits the page width. A long `LR` chain overflows the print width and gets clipped.
- Rule of thumb: **short → LR is fine; long chain → TD.** In reports, when unsure, pick TD (Print Friendly). Design docs can lean on `LR` more freely (the on-screen container scrolls horizontally).

## Tables

GFM tables for structured comparisons (task/slice tables, risk tiers, option matrices) instead of nested bullet lists.

## Review gate (L-tier)

The committed `.mdx` file IS the L-tier review artifact: surface its path to the user, resolve open questions by asking the user, gate on approval before implementation. S/M-tier: text summary sufficient.

## After writing a design doc

- Doc landed in `docs/src/content/docs/design/` → run `npm run build` in the site dir when feasible; broken MDX fails the build (Astro 7 validates JSX-style — no HTML auto-correction, close every tag).
- Decision made mid-plan that outlives the scope → promote it to `docs/.../design/` before the session ends; the Stop hook nudges once if source changed but docs didn't.

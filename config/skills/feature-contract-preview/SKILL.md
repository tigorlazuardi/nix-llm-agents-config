---
name: feature-contract-preview
description: When implementing a single feature (not bootstrapping a codebase), first write a concise MDX contract preview (Astro/Starlight dialect) — requirement / acceptance criteria, API I/O shape (request, response, error cases), data contract (fields + types), and expected output — and STOP at the contract level, no code-level detail. The user prefers reviewing expected output, requirements, and contracts, not example code. Use when adding or changing a feature, endpoint, or flow in an existing codebase and the user wants to review the contract before implementation. For full codebase bootstrap with code-level patterns, use `codebase-pattern-preview` instead; pairs with `astro-docs-authoring`.
---

# Feature contract preview

When implementing ONE feature in an existing codebase, write a short MDX contract preview FIRST, let the human approve it, THEN implement. This is smaller than `codebase-pattern-preview`: it covers a single feature and stops at the contract — requirement, I/O shape, error cases, expected output. No example code, no implementation detail.

The user reads expected output + requirements + contract to decide. Do not include code-level snippets, function bodies, or internal logic. JSON shapes and type/field tables are fine (they describe the contract, not the code).

Authoring rules (MDX blocks, Mermaid, discovery, read-only) come from `astro-docs-authoring`. Write into `plans/` (non-ignored, non-dotted), then tell the user the path; promote to the docs site per `astro-docs-authoring` when it outlives the scope.

## What the preview MUST contain (and nothing more)

One short `.mdx` per feature, in order:

1. **Feature** — one or two lines: what it does, who it's for.
2. **Requirements / acceptance criteria** — bullet list of what "done" means. Testable statements.
3. **API I/O shape** — for each endpoint/operation the feature adds or changes:
   - request shape (method + path, params/body fields + types),
   - success response shape,
   - error cases (each error: when it happens + the response shape/code).
   Use `<Tabs>`/`<TabItem>` with `request` / `success` / `error` tabs showing JSON shapes only.
4. **Data contract** — the core entities/fields this feature touches: field name, type, required?, notes. A table, not code.
5. **Expected output / behavior** — what the user/caller observes for each main case, including the not-happy paths (empty, error, unauthorized).
6. **Decisions** — any real choice as `<Decision status="proposed">` (the human flips to accepted/rejected).
7. **Open questions** — `<Aside type="caution">` for anything needing the human's call before implementation.

Do NOT include: folder structure, function signatures, example implementation code, library wiring, test code. Those belong to implementation (or to `codebase-pattern-preview` for a bootstrap). If a flow needs explaining, use a Mermaid diagram, not code.

## Error flow is mandatory — not just a list, but where it goes

Every operation enumerates its error cases explicitly — even "not implemented yet" — AND says what happens to each error. Listing the error is not enough; the preview must show the full disposition of every potential error so nothing silently disappears.

For each potential error, an **Error flow table** with these columns:

| Trigger | Where caught | Disposition | Surfaced as | Logged? |
|---|---|---|---|---|

- **Trigger** — the condition that raises it (e.g. "user not signed in", "DB timeout", "product missing").
- **Where caught** — which layer owns it (e.g. middleware / handler / service / repo / boundary). Make ownership explicit so it isn't caught nowhere or twice.
- **Disposition** — what is done: mapped to a response, retried, swallowed-with-default, propagated up, fallback value. If swallowed, justify it.
- **Surfaced as** — what the caller/user observes: HTTP status + code, UI toast/inline/empty/boundary, or "none (internal)".
- **Logged?** — yes/no + level. Unexpected/internal errors must be logged; expected business errors usually need not spam logs.

Rules:
- No error may be "caught nowhere" (would crash/blank) or "caught everywhere" (swallowed silently). Every row has exactly one owning layer.
- Distinguish **expected** errors (validation, not-found, conflict, unauthenticated → mapped to a clean response, usually not logged as error) from **unexpected** errors (bug, dependency down, timeout → generic 500-style message to caller, full detail logged, never leaked to UI).
- Cross-cutting failures (DB down, upstream timeout, network) must appear too, not just business errors.
- Where helpful, a Mermaid diagram of the error path (req → layer that raises → layer that catches → what the caller sees).

This mirrors the user's rule that everything fallible has a defined, visible error path — extended so the preview also pins down where each error is handled and what it becomes.

## Example skeleton

````mdx
# Feature — Add to wishlist

Lets a signed-in user save a product to their wishlist.

## Requirements
- Signed-in user can add a product to their wishlist.
- Adding the same product twice is idempotent (no duplicate, no error).
- Guests get a 401, not a silent failure.

## API I/O — POST /api/wishlist
<Tabs>
  <TabItem label="request">
    ```json
    { "productId": "p_123" }
    ```
  </TabItem>
  <TabItem label="success">
    ```json
    { "id": "w_1", "productId": "p_123", "addedAt": "2026-01-01T00:00:00Z" }
    ```
  </TabItem>
  <TabItem label="error">
    ```json
    { "error": "Not signed in", "code": "UNAUTHENTICATED" }   // 401
    { "error": "Product not found", "code": "NOT_FOUND" }     // 404
    ```
  </TabItem>
</Tabs>

## Error flow
| Trigger | Where caught | Disposition | Surfaced as | Logged? |
|---|---|---|---|---|
| Not signed in | auth middleware | reject before handler | 401 UNAUTHENTICATED; UI sign-in prompt | no |
| Product missing | service | map to not-found | 404 NOT_FOUND; UI inline error | no |
| Duplicate add | service | swallow (idempotent), return existing | 200 success | no |
| DB timeout / down | repo → boundary | propagate, generic message | 500 INTERNAL; UI error toast + retry | yes (error) |

## Data contract — WishlistItem
| Field | Type | Required | Notes |
|---|---|---|---|
| id | string | yes | server-generated |
| productId | string | yes | must reference a product |
| addedAt | string (ISO) | yes | server-set |

## Expected output
- Add succeeds → item appears in the user's wishlist list immediately.
- Add duplicate → same list, no error, no duplicate row.
- Guest → 401, UI shows a sign-in prompt (not a silent no-op).

## Decisions
<Decision title="Adding a duplicate is idempotent, not an error" status="proposed">
Simpler UX; avoids a needless error path for a benign action.
</Decision>

<Aside type="caution" title="Needs your call">
Wishlist cap per user? Unlimited for now unless you say otherwise.
</Aside>
````

## Flow

1. Write the `.mdx` contract preview into `plans/`; tell the user the path (renders on GitHub; promote to the docs site for a live render).
2. Human reviews, flips `<Decision>` statuses, answers `<Aside>` questions.
3. Only after sign-off, implement the feature.

---
name: coding-standards
description: Author a CODING_STANDARDS.md for a repo that doesn't have one — derive it from existing code patterns, stack, and specs/ADRs rather than inventing rules. Use when the user says "author coding standards", "define coding standard", "bikin CODING_STANDARDS", "write CODING_STANDARDS.md", "establish code conventions", "document our conventions", or when a preflight check reports standards are missing before parallel implementer fan-out. Also triggers on "standards preflight".
---

A repo about to fan out N implementer agents in parallel needs one documented
style for all of them to converge on — write it after fan-out starts and
you're reconciling N invented styles instead of enforcing one.

## 1. Check first — don't duplicate

Look for `CODING_STANDARDS.md` at repo root, and for a standards section inside
`CONTRIBUTING.md`. If either already documents conventions: **stop, report
what exists and where, do nothing else.** This skill fills a gap; it doesn't
overwrite one.

## 2. Derive, don't invent

The standard describes what the repo already does, plus stack-driven defaults
where the repo is silent. Interview the user only for genuine forks — never a
long questionnaire.

**Brownfield (code already exists):**

- Sample a spread of files (not just one directory) to find the *dominant*
  pattern — naming, module/file layout, error handling shape, test style.
  Where two patterns compete, the more recent or more frequent one wins;
  note the older one as legacy, don't standardize on it.
- Read whatever formatter/linter config exists (`.prettierrc`, `.eslintrc`,
  `ruff.toml`, `.golangci.yml`, `rustfmt.toml`, etc.) — formatting rules come
  from there, never re-specify them in prose.
- Identify the stack from manifest files (`package.json`, `pyproject.toml`,
  `go.mod`, `Cargo.toml`, ...) — stack conventions (e.g. Go: `errors.Is`,
  Rust: `Result`, not exceptions) fill gaps the sampled code doesn't answer.
- Check `docs/` for specs or ADRs that already made a style-adjacent decision
  (e.g. "all API errors are typed") — those are binding, not optional.

**Greenfield (no code yet, or too little to show a pattern):** derive from
stack + spec/ADR defaults, then ask the user **at most 3–5 questions**, and
only for decisions that genuinely fork (e.g. "errors as exceptions or Result
types?", "test files colocated or in `tests/`?"). Skip anything the stack or
spec already settles.

## 3. Write `CODING_STANDARDS.md` at repo root

Short and enforceable: every rule must be checkable by a reviewer looking at
a diff. Reject aspirational lines like "write clean code" or "be consistent"
— if a rule can't fail a diff, cut it. Structure:

- **Formatting** — one line: "enforced by `<tool>`, see `<config file>`."
  Never restate the formatter's rules in prose.
- **Naming** — casing/prefix conventions actually observed (functions,
  types, files, tests).
- **Module / seam conventions** — where new code of a given kind goes, how
  modules depend on each other, what's public vs internal.
- **Error handling** — the repo's actual shape (exceptions vs Result/Either,
  wrapping vs propagating, logging discipline).
- **Testing** — seam (unit vs integration boundary) and style (naming,
  fixture conventions, what must be tested vs may be skipped).
- **Comments / documentation** — when a comment is required vs noise (e.g.
  "public API needs a doc comment; inline comments explain why, not what").
- **Repo-specific prohibitions** — concrete "never do X" items pulled from
  actual repo history/conventions, not generic advice.

Close the standards section with this line, verbatim in spirit:

> The Fowler smell baseline from the `code-review` skill still applies below
> these standards. Where this document and the baseline disagree, this
> document wins.

## 4. Split off the machine-enforceable subset into `.pi/rules/`

Some rules are mechanical and path-scoped ("every file under `src/api/**`
must export a Zod schema") — those belong in `.pi/rules/<name>.md` with
`paths:` frontmatter (see the `promote-rules` skill for the exact format:
`description:` required, `paths:` glob list). Only split off what's truly
mechanical and path-scoped; everything else stays prose in
`CODING_STANDARDS.md` — don't fragment the document chasing rule files for
rules a linter can't check anyway.

**Permission gate:** in a normal interactive session, propose the `.pi/rules/`
file and get explicit user approval before writing it — same as
`promote-rules`.

## 5. Close with the pathfinder note

End the document with one short paragraph: the first ticket touched in any
area of the codebase sets the living pattern for that area — reviewers after
it check new code against *both* anchors, this standards doc and the actual
code the first ticket produced. When the two disagree, that's a signal the
standard needs updating, not that the code is wrong by default.

## Report

State: path written, whether `.pi/rules/` files were also written (and
whether that required user approval), and one line on what the standard was
derived from (sampled files / stack manifest / spec docs / user answers).

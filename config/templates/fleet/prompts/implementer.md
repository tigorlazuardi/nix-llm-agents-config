# Implementer spawn prompt

Contract for the fleet orchestrator to inject verbatim (placeholders filled) when spawning
an implementer for one task node. Source of truth:
`docs/design/2026-07-12-fleet-revamp.mdx` (§Pointer protocol, §Git model, §Redaksi secrets).
Do not deviate from this contract; do not read or write `state.json` — that file belongs
to the orchestrator.

---

Run: {{RUN}} · DAG: {{DAG_ID}} · Task: {{TASK_ID}} · Attempt: {{ATTEMPT}}

## Spec

Read {{TICKET_REF}} — this is your ticket, the entire spec of your work. Read
{{STANDARDS_REF}} and follow it; it is the enforced coding standard for this repo, not a
suggestion.

{{POINTER_FILE}} — if this is set, read it FIRST, before anything else. It is either a
prior reviewer's findings or a prior implementer's handover. Treat it as the most current
truth about what's broken or half-done.

## Where you work

Work ONLY inside the worktree at {{WORKTREE_PATH}}, on branch {{BRANCH}}. Use
`git -C {{WORKTREE_PATH}} ...` for every git command — never `cd` there, never touch any
other branch or worktree. If the branch differs from {{BRANCH}}, stop and report — do not
improvise a different branch.

## How you work

- Use `/tdd` at the seams the ticket calls out. Run typechecking regularly, not just at
  the end.
- If this task touches frontend UI, load the `frontend-design` skill before writing any
  component code.
- **Commit discipline**: one unit of work = one commit. A new fix is a new commit, never
  an amend or a rebase. Do NOT push — the orchestrator pushes. Do NOT force-push. Do NOT
  run `git clean`.
- Run focused tests/checks useful while implementing, but never run the exact contract
  `checkCommand`; the orchestrator owns that single acceptance run after standards PASS.

## Notes file

Write your work log, findings, and decisions to
`.fleet/{{RUN}}/notes/{{TASK_ID}}-implementer-{{ATTEMPT}}.md`. Keep it short — a human
reads this, not a dump of your reasoning. State what you did, what you decided and why,
and anything the next reader (reviewer or a fresh implementer) needs to know.

**Redact secrets in everything you write** — this file, commit messages, error text. Scrub
known env values and common patterns (`AKIA…`, `ghp_…`, JWTs, password-bearing URLs) to
`[REDACTED:NAME]` before it hits disk.

## If you hit a turn or context limit

Stop cleanly. Write a handover file at
`.fleet/{{RUN}}/notes/{{TASK_ID}}-implementer-{{ATTEMPT}}-handover.md` covering: state of
the work, what's done, what's left, and any gotcha a fresh implementer needs. Then report
verdict `HANDOVER`.

## If the task turns out to be low-tolerance

If you discover the task actually touches auth, secrets, a DB migration, schema, money, or
another irreversible surface that wasn't in the plan, STOP before touching that part.
Explain in `SUMMARY` and report verdict `ESCALATE`.

## Your reply

Your final reply MUST be exactly this verdict block and nothing else — no prose before or
after it:

```
VERDICT: PASS|FAIL|HANDOVER|ESCALATE|BLOCKED
SUMMARY: <1-2 kalimat>
REF: <path file notes/handover relative repo root>
ATTRIBUTES: commitSha=<sha>; focusedChecks=<summary|skipped>; <k>=<v>...
```

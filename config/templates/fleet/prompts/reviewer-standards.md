# Reviewer prompt — axis 1: standards

Contract for the fleet orchestrator to inject verbatim (placeholders filled) when spawning
the standards reviewer for one task node — axis 1 of two, run FIRST, before axis 2
(`reviewer-spec.md`). Source of truth:
`docs/design/2026-07-12-fleet-revamp.mdx` (§Topologi, §Pointer protocol, §Git model,
§Redaksi secrets). Do not deviate from this contract; do not read or write `state.json` —
that file belongs to the orchestrator.

---

Run: {{RUN}} · DAG: {{DAG_ID}} · Task: {{TASK_ID}} · Attempt: {{ATTEMPT}}

## What to review

Diff: `git -C {{WORKTREE_PATH}} diff {{FIXED_POINT}}...HEAD` on branch {{BRANCH}}. Also read
{{IMPL_REF}} — the implementer's notes for this attempt — for context on what they did and
decided.

{{POINTER_FILE}} — if this is set, read it too: it is an earlier reviewer's findings from a
prior fix-loop attempt on this same task, useful to confirm whether prior issues actually
got fixed.

Review ONE axis only — standards, not spec/ticket fit, that is the other reviewer's job:

- Does the diff follow {{STANDARDS_REF}}, plus the baseline code-smell judgement calls
  (Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession,
  Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message
  Chains, Middle Man, Refused Bequest)? A documented repo standard overrides the baseline;
  skip anything tooling already enforces.

Do not judge whether the diff matches the ticket/spec, whether requirements are missing, or
scope creep — that's `reviewer-spec`'s job, run after you PASS.

## No check command

This axis is static and cheap by design — fail fast before the check command runs. Do NOT
run any test/build/check command; there is no check-command placeholder for this axis.

## Read-only

Do NOT edit code. You only read the diff and notes, and write your findings file.

## Findings file

- **FAIL** — write actionable findings to
  `.fleet/{{RUN}}/notes/{{TASK_ID}}-reviewer-standards-{{ATTEMPT}}.md`, one item per
  file:line. Write it self-contained: a fresh implementer with no memory of this review
  will read it as their only source of truth for what to fix.
- **PASS** — the file can be brief (a line or two is fine).

**Redact secrets in everything you write** — scrub known env values and common patterns
(`AKIA…`, `ghp_…`, JWTs, password-bearing URLs) to `[REDACTED:NAME]` before it hits disk.

## If the diff is low-tolerance

If the diff touches auth, secrets, a DB migration, schema, money, or another irreversible
surface, report verdict `ESCALATE` regardless of anything else — standards review reads the
whole diff too and can catch this before spec review or the check command ever run.

## Your reply

Your final reply MUST be exactly this verdict block and nothing else — no prose before or
after it:

```
VERDICT: PASS|FAIL|HANDOVER|ESCALATE|BLOCKED
SUMMARY: <1-2 kalimat>
REF: <path file notes/handover relative repo root>
ATTRIBUTES: axis=standards; commitSha=<sha>; <k>=<v>...
```

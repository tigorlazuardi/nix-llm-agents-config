# Reviewer prompt — axis 2: spec

Spawn only after standards review passed and orchestrator ran exact immutable check once.
Do not read or write `state.json`; orchestrator owns it.

Run: {{RUN}} · DAG: {{DAG_ID}} · Task: {{TASK_ID}} · Attempt: {{ATTEMPT}}

Review `git -C {{WORKTREE_PATH}} diff {{FIXED_POINT}}...HEAD` on {{BRANCH}}, {{TICKET_REF}},
{{IMPL_REF}}, and optional {{POINTER_FILE}}. Review spec fit only; standards already passed.

## Recorded check evidence

Read {{CHECK_EVIDENCE_REF}}. It must identify this task, commit {{COMMIT_SHA}}, exact immutable
command hash, exit code 0, timestamps, and output pointer. Never run or rerun `checkCommand`.
Missing, stale, malformed, non-green, or mismatched evidence → `BLOCKED`.

Do not edit source. Write findings to
`.fleet/{{RUN}}/notes/{{TASK_ID}}-reviewer-spec-{{ATTEMPT}}.md`. Redact secret values.
Low-tolerance work on standard route → `ESCALATE`.

Reply exactly:
```
VERDICT: PASS|FAIL|ESCALATE|BLOCKED
SUMMARY: <1-2 sentences>
REF: <review file path>
ATTRIBUTES: axis=spec; commitSha={{COMMIT_SHA}}; checkEvidence={{CHECK_EVIDENCE_REF}}; <k>=<v>...
```

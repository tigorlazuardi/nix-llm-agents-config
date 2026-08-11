---
description: Review changes for bugs, security, error handling
argument-hint: "[scope]"
subagent: reviewer
fresh: true
---
Review the changes. Scope: ${1:-git diff, then git diff --cached; if both empty, review last commit via git show}.

Read-only review. Do not edit, create, delete, stage, or commit files. Return report only; never implement fixes.

Focus, in order:

- Correctness bugs, logic errors, edge cases
- Security: injection, secrets, authz, unsafe input
- Error handling gaps, unchecked failures, swallowed errors
- Concurrency / resource leaks

Per finding output one line: `path:line — severity: problem. fix.`
Skip style nits unless they change meaning. No praise. If clean, say so.

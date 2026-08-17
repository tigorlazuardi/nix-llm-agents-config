---
description: Supervise — execute accepted scope through one writer and independent review
argument-hint: "<accepted scope/spec/ticket/fix ref>"
---
Supervise execution: $@

Main stays project-source read-only. All work routes through `implementer` + `reviewer` using fixed `standard|frontier` routing. Exactly one child writes at a time. Every child starts fresh with immutable scope, standards, selected skills, checks, findings, and evidence pointers needed for its pass.

1. Resolve one accepted spec, ticket, or diagnosed fix plus exact `checkCommand`; read project instructions and current diff. Stop for user decision until scope, preserved changes, risk route, skills, and check are fixed.
2. Resolve repo-root `CODING_STANDARDS.md`. If missing, stop and request permission to invoke `coding-standards`. Reviews use `code-review` semantics.
3. Create compact report/evidence paths. Spawn fresh writer with scope, standards, skills, and output path; writer leaves `checkCommand` to supervisor. Complete pass when writer returns verdict plus changed-file/report pointers.
4. Spawn fresh read-only `standards` reviewer. On FAIL, send findings pointer to fresh writer, increment shared fix count, then repeat. Stop after PASS or ten failed fix passes.
5. After standards PASS, main runs exact `checkCommand`; record command, exit status, timestamp, revision/diff identity, and output pointer. Failure enters same fix loop, then restarts standards review.
6. After green check, spawn fresh read-only `spec` reviewer using accepted scope and recorded check evidence. FAIL enters same fix loop, then restarts standards review.
7. Complete with terminal verdict, changed-file/report pointers, exact check evidence, fix count, and residual risks; otherwise return terminal blocked/escalated evidence.

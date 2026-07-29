---
description: Direct — execute accepted scope as main sole writer.
argument-hint: "<accepted scope/spec/ticket/fix ref>"
---
`/direct` grants main sole-writer permission for accepted scope: $@

1. Resolve exact bounds from argument plus accepted spec/ticket or diagnosed fix. If identity or bounds are missing, stop for focused clarification. **Complete when one accepted scope is unambiguous.**
2. Read project instructions, `CODING_STANDARDS.md` when present, accepted scope, current diff, and required skills. Preserve unrelated changes and all safety gates. **Complete when constraints, skills, and validation commands are known before editing.**
3. Implement minimal in-scope change as sole project-source writer. Keep implementation local to main; use no implementation subagents. Scope growth or a new product/architecture decision ends this run with a mode recommendation. **Complete when accepted scope is implemented without unrelated changes.**
4. Run scope-required build/test/lint checks and best-effort LSP diagnostics on edited files. **Complete when required checks pass or a failure/block is recorded exactly.**
5. Report changed files, commands and results, skipped checks, findings, and residual risks. **Completion is implemented accepted scope with recorded validation, or terminal blocked/escalated evidence.**

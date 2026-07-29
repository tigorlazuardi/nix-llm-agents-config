---
description: Write tests first (TDD) for a target
argument-hint: "<target>"
---
Write tests for: $@

Test-first discipline:
1. Identify behavior to cover — happy path, edge cases, error cases.
2. Write failing tests FIRST, using the project's existing test framework and conventions (detect from the repo — Go: `*_test.go`/`go test`; TS/JS: jest/vitest; Python: pytest). Do not invent a framework.
3. Run them — confirm they fail for the right reason.
4. Only then implement / fix until green.
5. Run full test command; paste output.

Keep tests focused and readable. One assertion-of-intent per test where practical. Report pass/fail honestly with the actual command output.

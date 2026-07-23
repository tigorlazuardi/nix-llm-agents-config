---
description: Execute one generated machine-local ticket drain
argument-hint: "<path-to-DRAIN-PROMPT.md>"
---
# Drain loader

Generated runtime prompt: `$1`

1. Resolve `$1` to a regular, non-symlink file inside the current repository's `.pi/drain/`. Require exactly one argument.
   **Complete when:** canonical prompt path, repository root, and Git common dir are known and same-repo.
2. Read prompt frontmatter only. Resolve its sibling contract path; require regular JSON inside the same `.pi/drain/` and no symlink traversal.
   **Complete when:** prompt declares contract path and expected SHA-256.
3. Parse contract, recompute SHA-256, and compare expected hash. Require contract `repository.gitCommonDir` equals `git rev-parse --git-common-dir` after canonicalization.
   **Complete when:** hash, schema version, clone identity, and prompt/contract pairing pass. Failure stops before tracker query or mutation and points to `/drain-wizard`.
4. Read the complete generated prompt and its required `REFERENCE.md` context pointer, then execute its ordered steps exactly. Contract values and ledger are runtime state; this loader adds no policy.
   **Complete when:** generated prompt returns its strict terminal block.

Relay that terminal block unchanged.

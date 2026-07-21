# fleet/ state schema

State artefacts for the fleet orchestration redesign. Single source of truth:
`docs/design/2026-07-12-fleet-revamp.mdx` (§State — fleet.json & state.json,
§audit[], §Git model, §Layout .fleet/, §Preflight). These are the only active generation. Obsolete root-level fleet/Ralph templates were deleted; historical docs are archival, not runtime contracts.

## Files

- `fleet.schema.json` — JSON Schema (draft 2020-12) for `fleet.json`, owned by
  the captain, always present (including L / 1 DAG). Index of DAG-of-DAG.
- `state.schema.json` — JSON Schema for `state.json`, owned by the orchestrator,
  one file per DAG. `nodes[]` = tasks derived from tickets.
- Both schemas duplicate an identical `$defs.auditSpan` (OTel-span-shaped, one
  entry per spawn) rather than cross-file `$ref`, so each file validates
  standalone offline.
- `fleet.template.json` / `state.template.json` — minimal instantiable
  examples (1 DAG, 2 nodes with a `dependsOn` edge) that pass their schema and
  `validate.mjs`. Copy and fill in `<placeholder>` strings.
- `validate.mjs` — zero-dependency (no npm install, no ajv) Node ≥20 CLI
  validator. Schema files stay as documentation / for an external ajv later;
  this script hand-rolls the structural checks plus what a schema alone can't
  express: graph cycles, file existence, routing class validity + low-tolerance
  safety floor, branch naming.

## prompts/

`prompts/implementer.md`, `prompts/reviewer-standards.md`, and `prompts/reviewer-spec.md`
are the spawn-prompt contracts for the worker roles — the orchestrator injects one of
these (placeholders filled) as the task prompt when spawning
`implementer`/`frontier-implementer` via the `subagent` tool. Not a new agent file; the
consolidated implementation agents stay as-is, the contract arrives through the spawn prompt. The
orchestrator never opens the ticket, standards doc, or notes files itself — it only
fills placeholders and reads back the worker's verdict block.

Review is two FRESH reviewer subagents run in sequence, never in parallel:
`reviewer-standards` (axis 1) first — static/cheap, no check command, fails fast — then,
only on its PASS, `reviewer-spec` (axis 2) — ticket/spec fit, consumes orchestrator-recorded green check evidence and MUST NOT rerun the check command.
`fixAttempt` is one counter shared by both axes; a FAIL from either restarts the review
from `reviewer-standards` on the next attempt.

Shared placeholders: `{{RUN}}`, `{{DAG_ID}}`, `{{TASK_ID}}`, `{{TICKET_REF}}`,
`{{CHECK_COMMAND}}`, `{{BRANCH}}`, `{{WORKTREE_PATH}}`, `{{STANDARDS_REF}}`,
`{{POINTER_FILE}}` (optional — prior reviewer/handover file), `{{ATTEMPT}}`.
Reviewer-only: `{{IMPL_REF}}` (implementer's notes), `{{FIXED_POINT}}` (diff base).
`{{CHECK_COMMAND}}` is injected only into implementer context and held by orchestrator for its single authoritative run. Neither reviewer receives it. Spec review receives `{{CHECK_EVIDENCE_REF}}` and `{{COMMIT_SHA}}`.

All three templates end in the same verdict block
(`VERDICT`/`SUMMARY`/`REF`/`ATTRIBUTES`) — the worker's entire reply back to the
orchestrator, per §Pointer protocol. Reviewer `ATTRIBUTES` always include `axis=standards`
or `axis=spec`. Neither template ever tells the worker to read or write `state.json`;
that file is orchestrator-owned.

## Running the validator

```sh
node validate.mjs <path-to-run-dir>
```

`<run-dir>` must contain `fleet.json` at its root plus each DAG's `state.json`
at the relative path named in `fleet.json`'s `dags[].statePath` (normally
`dags/<id>/state.json`).

Checks performed: JSON parses; required fields/enums/types per schema;
`dags[].dependsOn` and `nodes[].dependsOn` have no cycle and all resolve to an
existing id; every node's `routing.checkCommand` is non-empty;
`routing.worker`/`routing.reviewer` are each a valid CLASS (`worker|frontier`
— not a concrete agent name; resolution to a concrete agent happens at spawn
time via the matching agent listing's `class:` frontmatter) and, for
`failureTolerance:"low"` nodes, both are `"frontier"` (safety floor — worker
and reviewer identity being different is already guaranteed by the
fresh-spawn-per-axis protocol, not by this field); every `statePath` file
exists; audit span invariant `error != null <=> status == "error"`;
`runtime.branch` matches `fleet/<run>/task/<dagId>/<taskId>`;
`meta.integrationBranch` matches `fleet/<run>/int`; orchestrator is immutable `cx/gpt-5.6-terra`/`low`; canonical uppercase phases, current-child identity, per-axis reviewer retries, check retry, and evidence pointers exist for exact resume.

Exit 0 = all checks passed. Exit 1 = prints every failing file/path with a
message.

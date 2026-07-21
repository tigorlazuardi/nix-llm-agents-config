---
description: Fleet — derive and validate XL execution graph
argument-hint: "<approved spec/ticket refs>"
---
Fleet planning request: $@
# Fleet Plan — derive a fleet contract from spec + tickets

FASE 1 already happened: `to-spec` produced a spec, `to-tickets` broke it into vertical-slice
tickets with blocking edges. This skill does not redesign or re-interview any of that — it
**derives** the fleet run's state files from what FASE 1 already decided.

Source of truth for every rule below: `docs/design/2026-07-12-fleet-revamp.mdx`. Concrete
schemas: `~/.pi/agent/templates/fleet/{fleet,state}.schema.json` + `validate.mjs`. If this
skill and the ADR ever disagree, the ADR wins — re-read it.

**Contract = derivation, not invention.** 1 spec = 1 DAG. 1 ticket = 1 task node. A ticket's
"Blocked by" list becomes that node's `dependsOn[]`. Fleet is **XL-only**: multiple dependent
tickets, parallel DAG work, or a DAG-of-DAG. Gone for good: wave-based execution,
`acceptance.command` loops, a 10-branch interview, and separate `FLEET.md`/per-DAG contract
markdown — state files and referenced tickets ARE the contract; don't duplicate them into prose.

Use this prompt only after explicit `/fleet`. Derive and preview contract, then stop for human
approval. Execution or resume requires separate explicit `/captain`. Smaller coherent work
belongs to `/direct` or `/supervise`; do not convert it into Fleet machinery.

---

## 1. Gather inputs

Read, don't ask:

- The spec(s) produced by `to-spec` (one per DAG; XL may have several from a wayfinder map).
- The tickets produced by `to-tickets` for each spec — file (`tickets.md`) or tracker issues.
  Note each ticket's title, "Blocked by", acceptance criteria, and (for a real tracker) its
  issue ref/number.
- The tracker type actually configured (`docs/agents/issue-tracker.md` /
  `setup-matt-pocock-skills` output) — feeds `tracker.type`/`supportsBlocking`.
- Repo git remote (`git remote get-url origin`) and current branch — feeds `git.remote`,
  `meta.baseBranch`.

If inputs do not describe XL work with multiple dependent tickets, parallel DAG work, or a
DAG-of-DAG, stop and recommend the appropriate explicit mode; do not stretch Fleet to fit.

If a spec has no tickets yet, or a ticket set looks like raw scope rather than approved
tracer-bullet slices, stop and point the user at `to-tickets` first. Do not invent tickets here.

---

## 2. Derive DAGs and task nodes

- **1 spec → 1 DAG.** DAG `id` your own short slug (`d1`, `d2`, ...). `ref` = the spec's path
  or tracker URL. `dependsOn[]` at the DAG level = cross-spec ordering (empty for a lone-spec
  L run; derived from the wayfinder map for XL).
- **1 ticket → 1 task node.** Node `id` (`t1`, `t2`, ...). `ticket.ref` = the ticket's file
  anchor or issue URL/number, `ticket.title` copied verbatim. `dependsOn[]` = the ids of the
  tickets it's "Blocked by" (empty if "None — can start immediately").
- **Cap 10 task nodes per DAG.** A spec whose tickets exceed 10 does not get invented scope —
  split its derived DAG into two (`d1a`, `d1b`, ...), keep `ref` pointing at the same spec on
  both, and wire a `dependsOn` edge between them following the tickets' own dependency cut.
- **Closing task per DAG.** Append one extra node per DAG beyond the 1:1 ticket mapping: its
  `checkCommand` is the DAG's integration test — the command that proves this DAG's tickets
  integrate, not just each one in isolation. `dependsOn[]` = every other node id in the DAG (it
  runs last). This is the one deliberate exception to strict 1 ticket = 1 node; it exists
  because the judge trusts recorded `acceptanceResult`, it never executes commands itself, so
  someone has to produce a real cross-task green before judgment.

Verify both graphs (DAG-level `dependsOn`, and each DAG's node-level `dependsOn`) are acyclic
before writing anything.

---

## 3. Assign routing per node

The schema's `routing` object is small on purpose: `failureTolerance`, `worker`, `reviewer`,
`checkCommand`. Nothing else — don't add fields it doesn't have.

`routing.worker`/`routing.reviewer` hold a CLASS (`worker` | `frontier`), not a concrete agent
name — this is what makes the contract route-stable. Resolution is fixed: `worker` → `implementer` + `reviewer`; `frontier` → `frontier-implementer` + `frontier-reviewer`. No provider choice or failover exists.

**`failureTolerance` per node** — classify the ticket's actual surface, not its size:

- **`low`** — auth, secrets, DB migration, schema change, public-API contract, money/payments,
  data deletion, any irreversible op. → `worker: "frontier"`, `reviewer: "frontier"` (safety
  floor — `validate.mjs` rejects anything less for a `low` node).
- **`standard`** — routine feature work, bounded, easy to verify. → `worker: "worker"`,
  `reviewer: "worker"`.
- **`trivial`** — mechanical, scaffolding, config, docs. → same as `standard`.

Class is immutable once written. An `ESCALATE` verdict terminates that contract for captain/human action; orchestrator never bumps, downgrades, or reroutes it. Reviewer identity differing from
the producer is guaranteed by the fresh-spawn-per-axis protocol, not by this field — `worker`
and `reviewer` may legitimately hold the same class value.

**`checkCommand` per node** — a real, executable command that proves that specific ticket:
scoped unit/integration test, a lint target, a build target. Never "manual inspection". A
ticket that writes data or renders UI must get a `checkCommand` that actually exercises that
(hits a real DB / real render), not a typecheck-only stand-in — see the preflight in §5.

---

## 4. Frontier gate (softened)

FASE 1 already carried the architectural weight — this is a routing pass, not a design
session. So:

- If the current model is a frontier model, proceed as normal.
- If it isn't (a worker model), you may still author this contract — print one line warning
  the user that routing/failureTolerance calls were made by a worker model — **unless** step 3
  tagged any node `failureTolerance: low`. In that case STOP: low-tolerance classification is
  exactly the judgment call frontier models exist for. Ask the user to switch to a frontier
  model before deriving routing for that DAG (or the whole run).

This is separate from the safety ratchet in §3 — that decides which agent tier *runs* the
node at execution time and applies regardless of who authored the contract.

---

## 5. Preflight (mandatory, before writing any file)

**(a) Coding standards.** Check the repo root for `CODING_STANDARDS.md`. Missing → STOP. Point
the user at whatever skill in this repo covers authoring coding standards (a dedicated skill
for this is in progress alongside this one — search skill descriptions for "coding standard" /
"CODING_STANDARDS.md" before assuming none exists); if truly none exists yet, tell the user to
write `CODING_STANDARDS.md` by hand first. Do not proceed to §6 without it — a standard born
after fan-out is the textbook cause of a rusuh fleet. Once found, its path becomes
`meta.standardsRef` in every DAG's `state.json`. Ask user permission before invoking `coding-standards`; do not
author standards automatically.

**(b) Env verification (real reflection).** Read the repo (CI config, `docker-compose*`,
`.env.example`, Playwright/Cypress config, migration tooling) to determine, per ticket, whether
it needs a real DB, a real browser, or secrets to be meaningfully checked. A DAG whose tickets
need these must have `checkCommand`s that actually exercise them — never degrade to
typecheck/lint-only for a ticket that writes data or renders UI. If the repo can't currently
supply what a ticket needs (no DB reachable, no browser harness, missing env secret), STOP and
tell the user what to provision before this DAG can run — do not write a `checkCommand` that
would fake-green. No separate SETUP.md; say it once, inline, to the user.

Only after (a) and (b) are clear, move to §6 and write the files.

**(c) Static validation (after writing).** Run:

```sh
node ~/.pi/agent/templates/fleet/validate.mjs .fleet/<run>
```

Must exit 0. It checks: required fields/enums/types, no cycles in either graph, every
`dependsOn` resolves, every node has a non-empty `checkCommand`, `routing.worker`/`reviewer` are
valid classes (with the `low`-tolerance safety floor enforced), every
`statePath` file exists, audit-span invariants, and branch names matching
`fleet/<run>/task/<dagId>/<taskId>` / `fleet/<run>/int`. Fix and re-run until it passes — do not
hand off a run directory that fails this.

**(d) Human gate: graph preview.** Only after (c) passes, invoke the `fleet-draw` skill or the `fleet-draw` subagent
with a pointer to `.fleet/<run>/` and wait for its HTML report pointer. Show the pointer to the
user and ask them to open it and approve the graph **before** any captain dispatch. Do not tell
the user to launch the captain until they've approved.

---

## 6. Write the contract

**Target guard — before writing `.fleet/<run>`:** inspect `.fleet/<run>/`. If it exists or is
non-empty, STOP and report its state; never silently reuse or overwrite run state. Only after
fresh explicit user confirmation to overwrite may you continue. Immediately before the first
write, inspect `.fleet/<run>/` again. If its state changed since confirmation, STOP and report;
otherwise write only the target the user explicitly confirmed overwriting.

Instantiate from the templates in `~/.pi/agent/templates/fleet/` — copy `fleet.template.json`
and `state.template.json`, fill every `<placeholder>`, leave none unfilled.

**`runName`:** `<yyyy-mm-dd>-<slug>`.

**Layout** (`<repo>/.fleet/<run>/`):

```
.fleet/
  .gitignore              scaffold if missing (see below)
  <run>/
    fleet.json             captain-owned index, always present (even 1 DAG)
    dags/<id>/state.json   orchestrator-owned, one per DAG
    notes/                 tracked, empty scaffold now (audit + handover files land here at runtime)
```

`report/` and `worktrees/` are runtime/derived — don't create them; the orchestrator and the concrete fleet-draw subagent do. If `.fleet/.gitignore` doesn't already exist, scaffold it with:

```
*/worktrees/
*/report/
```

(both patterns anchor one level under `.fleet/`, so they match `<run>/worktrees/` and
`<run>/report/` for any run). Create `.fleet/<run>/notes/.gitkeep` so the empty tracked
directory survives `git add` (git doesn't track empty dirs).

**`fleet.json` (`meta`):** `schemaVersion: 1`, `createdAt` = now, `baseBranch` = the branch
this run is cut from, `integrationBranch: "fleet/<run>/int"`, `maxConcurrent: 3` (default —
raise only if the user asks and the repo's rate limits support it), `budget` = ask the user for
a token/cost ceiling; omit if they have none (it's optional in the schema). `mapRef` only for
XL (wayfinder map path).

**`fleet.json` (`git`):** `remote` from `git remote get-url origin`; `webTemplate` derived from
the remote host, e.g. `https://github.com/<org>/<repo>/commit/{sha}`.

**`fleet.json` (`dags[]`):** one entry per DAG from §2 — `id`, `ref` (specRef), `title`,
`statePath: "dags/<id>/state.json"`, `dependsOn`, `status: "PENDING"` (even DAGs with no
dependencies — the captain, not this prompt, computes the runnable set at dispatch time),
`judge: { "verdict": null, "attempt": 0 }`, `attributes: {}`, `audit: []`.

**Each `dags/<id>/state.json` (`meta`):** `runName`, `schemaVersion: 2`, `specRef`,
`standardsRef` (from preflight a), `baseBranch`, `integrationBranch`, immutable
`orchestrator`, and all four retry caps — same values as the parent contract.

**`tracker`:** `type` = whatever FASE 1's `to-tickets` actually published to (`local-md`,
`github`, `linear`, ...), `supportsBlocking` = true for a real tracker's native blocking links,
false for a local markdown file (edges live in prose there).

**`nodes[]`:** one entry per task node from §2 — `id`, `ticket.ref`/`ticket.title`,
`dependsOn`, `routing` (from §3), `runtime` all-defaults (`status`/`phase: "PENDING"`, `currentChild: null`, `reviewAxis: null`, all fix/handover/per-axis reviewer/check retry counters zero, `branch: "fleet/<run>/task/<dagId>/<taskId>"`, `commitSha: null`, and all evidence pointers null). `meta.orchestrator` is always `{ "agent": "orchestrator", "model": "cx/gpt-5.6-terra", "thinking": "low" }`; no risk-based orchestrator selection or upgrade exists., `sync: { "mirrored": false, "pushed": false }`,
`attributes: {}`, `audit: []`.

**`stopFlag`** in both files: `{ "stopped": false, "reason": null, "stoppedAt": null }`.

Now run preflight (c) and (d) from §5.

---

## 7. Terminal handoff

This skill is terminal — it does not dispatch, and it does not run the fleet. After (c) passes
and the user has approved the graph preview from (d):

```
✅ Fleet contract ready: .fleet/<run>/

  fleet.json              — captain index, all DAGs PENDING
  dags/<id>/state.json    — per-DAG state, one per DAG
  report/status-*.html    — graph preview (approved by you above)

Next:
1) Commit .fleet/<run>/ (state + notes are tracked; worktrees/report are gitignored).
2) Explicitly invoke `/captain .fleet/<run>/fleet.json` to execute or resume.
```

If there are DAG ordering constraints the user must know about (e.g. a migration DAG other
DAGs must not start until it passes), call them out explicitly here.

---
description: Executor — one ticket pass: worktree implementer, two-axis gates, SPLIT rule
argument-hint: "<issue-number> — invoking message carries the immutable execution tuple"
---
Executor pass for ticket: $@

One pass = one fresh implementer in a per-ticket worktree, one fresh standards review, the executor-run check, one fresh spec review. Standalone by design: no watchdog extension is required at runtime. The budgets and depth cap mirror the watchdog core (`config/extensions/drain-watchdog/index.ts`, `shouldSplit`: `STANDARDS_REVIEW_BUDGET_MS` = standards: 10 minutes, `SPEC_REVIEW_BUDGET_MS` = spec: 20 minutes, `SPLIT_DEPTH_CAP` 5); change the two together or note the skew. Parallel per-ticket worktrees merged into an integration branch, the merger child, and FINALIZING are issue #34 scope — this prompt is the single-ticket pass only.

## Immutable input

The invoking message, never the ticket body alone, supplies: ticket number, risk route (`standard|frontier`), exact `checkCommand`, standards doc pointer, preserved-changes pointer, and failed-pass budget. Never change route, check command, standards doc, preserved changes, or acceptance criteria mid-pass. Missing or contradictory input → terminal `BLOCKED` before any mutation. Fixed axis budgets: standards: 10 minutes, spec: 20 minutes — an over-budget completed FAIL triggers SPLIT, a within-budget FAIL enters the fix loop. Failed-pass budget defaults to ten failed passes and is never raised above ten.

## Hard rules

- Never poll, never sleep, never inspect transcripts: call `subagent` exactly once per fresh pass with `interactive:false`, persist the spawn, then end the turn — the result arrives as a wake.
- The executor never edits project source. Allowed: git worktree/branch operations, running the exact `checkCommand`, `gh` tracker calls, writing the pass report, spawning children.
- Exactly one writer at a time: the implementer child, inside its own worktree. Reviewers are read-only.
- Review durations are mandatory evidence: record UTC wall-clock at each review spawn and at each verdict arrival; both timestamps and the duration go into the pass report per axis.
- Low-tolerance work — auth/authz, secrets/credentials, DB migration/schema, public API contracts, money/payment, data deletion, irreversible operations — is handed off before any spawn, never implemented: comment the reason, relabel the ticket `ready-for-human`, end `BLOCKED`.

## Steps

1. Resolve every immutable input, read the ticket with `gh issue view <n> --comments`, and classify its scope. Create the pass workspace `/tmp/executor/<repo-slug>/<ticket>/` containing `pass-report.md` (header: ticket, route, check command identity, budgets, base SHA). **Complete when:** inputs are fixed or the pass is refused.
2. Create the ticket worktree from the current main HEAD: `git worktree add /tmp/executor/<repo-slug>/<ticket>/wt -b executor/<ticket>-<slug>`; record branch name and base SHA in the report. Docs-only tickets use the same worktree; the check applies to the docs diff whenever `checkCommand` covers the touched paths, and when it cannot, record `check: skipped (docs-only, command does not cover docs)` with the reason — a skip is recorded, never silent.
3. Spawn one fresh `implementer` in its own worktree. Task body carries unchanged pointers (ticket, standards doc, route, worktree path + branch, preserved changes, report path), the selected skills, and read/apply instructions; it must read and apply the `tdd` skill — red → green at agreed seams. Seams are the ones fixed in the invoking message; when none are fixed, the implementer records the seams it will test in its report before the first failing test and treats them as agreed for this pass. It commits to the worktree branch, never runs the exact `checkCommand`, and returns `PASS` (report ref + commit SHA) or `FAIL | HANDOVER | BLOCKED | ESCALATE`. End the turn.
4. Implementer `PASS` → record the arrival time and spawn one fresh read-only `standards-reviewer` with `axis=standards`, the diff range on the branch, and the standards doc; omit the check command. Implementer `HANDOVER` → respawn a fresh implementer with the handover pointer, handovers capped at 3, then `FAILED`. `BLOCKED` → `BLOCKED`. `ESCALATE` → `ESCALATED`. Malformed or missing verdict → `BLOCKED`. End the turn.
5. Standards `FAIL`: compare duration to standards: 10 minutes. Within budget → fix loop (step 9) with the findings pointer. Over budget → SPLIT procedure (step 10). Standards `PASS` → continue.
6. Run the exact `checkCommand` inside the ticket worktree at the implementer's final commit — tree verified clean, HEAD matching the reported commit SHA. The worktree at that commit is the single-ticket integration; no merge machinery exists in this pass. Record command, exit status, timestamp, HEAD, and output pointer. Non-zero → fix loop (step 9) with the output pointer.
7. Green check → record the evidence pointer and spawn one fresh read-only `deep-reviewer` with `axis=spec`, the accepted scope, and the green-check evidence; never supply the executable command. End the turn.
8. Spec `FAIL`: compare duration to spec: 20 minutes. Within budget → fix loop (step 9). Over budget → SPLIT procedure (step 10). Spec `PASS` → terminal `PASSED` (step 11). A review that never returns a verdict is not a FAIL: respawn one fresh same-axis reviewer (counted in the failed-pass budget), else `BLOCKED`.
9. Fix loop: spawn one fresh `implementer` with the findings or check-output pointer in the same worktree and branch. The counter is shared across standards, check, and spec failures; after every fix pass the review restarts at standards (step 4). At ten failed passes → terminal `FAILED`: comment the ticket with the findings pointers and stop. Never silently continue.
10. SPLIT procedure — only for a review that completes with FAIL over its axis budget, never for a fast FAIL and never for a hung review:
    a. Read the split depth from the origin body marker `split-depth: N` (missing = 0). At `N >= 5` do not split: relabel the origin `ready-for-human` with a reason comment and end `BLOCKED`.
    b. Keep the worktree and branch intact; partial work is a pointer for the child, never discarded silently.
    c. Create the child with strictly smaller implementation and review scope: only the failing finding set plus the acceptance criteria it gates. If no strictly smaller scope exists, relabel the origin `ready-for-human` with a reason comment and end `BLOCKED`.
    d. Child body: `parent: #<origin>`, `split-depth: <N+1>`, failing axis with duration and budget, findings pointers, partial-work pointer (worktree path + branch), and the explicit smaller-scope statement.
    e. Wire the native dependency — the endpoint goes on the origin (the blocked side) and takes the child's database id, not the issue number:
       `origin_db=$(gh api repos/{owner}/{repo}/issues/<origin> --jq .id)`
       `child_db=$(gh api repos/{owner}/{repo}/issues/<child> --jq .id)`
       `gh api --method POST repos/{owner}/{repo}/issues/<origin>/dependencies/blocked_by -F issue_id="$child_db"`
       Verify on the origin that `.issue_dependencies_summary.blocked_by` increased — the POST response can report success with `blocked_by_created: null`.
    f. Ready the child: add the `ready-for-agent` label and post the audit comment: "Readied by the executor agent under the SPLIT exception (issue #27 decision); origin #<origin> blocked by this ticket via native dependency; <axis> review FAIL after <duration> (budget <budget>); split-depth <N+1>; findings and partial work: <pointers>." Agent-readied SPLIT children are the only sanctioned self-readiness and only under this audit note.
    g. Comment on the origin that it is blocked by the child, record the split in the pass report, and end terminal `BLOCKED` — a split ends the pass; it never becomes a fix pass.
11. Terminals — exactly one, posted as the final reply and commented on the ticket with the pass report pointer. Leave main untouched and the tree clean; the branch, report, and comment are the deliverables, and merging or closing the ticket is integration scope:
    `VERDICT: PASSED | FAILED | BLOCKED | ESCALATED`
    `SUMMARY: <one sentence>`
    `TICKET: #<n>; BRANCH: <name>; REPORT: <path>`
    `ATTRIBUTES: failedPasses=<n>; handovers=<n>; splits=<n>; standardsReviews=<n>; specReviews=<n>`
    `PASSED` = standards PASS + green check + spec PASS. `FAILED` = failed-pass budget exhausted. `BLOCKED` = refused input, implementer `BLOCKED`, malformed or missing verdict, split, or handoff. `ESCALATED` = a child reported `ESCALATE`; never reroute, never retry.

# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- Create: `gh issue create --title "..." --body "..."`; use a heredoc for multiline bodies.
- Read: `gh issue view <number> --comments` and fetch labels.
- List: `gh issue list --state open --json number,title,body,labels,comments` with relevant label/state filters.
- Comment: `gh issue comment <number> --body "..."`.
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

Infer repository from current Git remote.

## Pull requests as a triage surface

External PRs are **not** a request or triage surface. Skills must triage GitHub Issues only.

## Skill vocabulary

- “Publish to the issue tracker” means create a GitHub issue.
- “Fetch the relevant ticket” means run `gh issue view <number> --comments`.

## Drain queue

The drain-watchdog is tracker-agnostic: it never reads the tracker. The model finds the run target
and its ticket tree and declares it with `watchdog_target` (`{ id, blockedBy?, state? }`, ids are
opaque strings). The watchdog holds the tree in its persisted run state.

- Pickable: state `open` and every `blockedBy` id known and `done`. An unknown blocker is not done.
- `watchdog_complete(id)` marks done; `watchdog_handoff(id, reason)` marks limbo (human review, never
  pickable, its dependents stay blocked); `watchdog_sync(tickets)` upserts by id (new SPLIT children,
  reopened or cancelled tickets; nothing is deleted).
- Limbo and blocked-by-limbo tickets do not block DONE; `watchdog_done` returns the done / limbo /
  blocked-by-limbo report.
- The tools never write to the tracker: the model moves ticket status there itself.

Refusal rule: an empty tree means refuse to arm, pause the run, or refuse `watchdog_done` - it is
never interpreted as "done".

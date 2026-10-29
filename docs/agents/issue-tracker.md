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

The drain-watchdog infers the queue from the run target's tree; nothing to configure. One GraphQL
query reads the target, its sub-issues (map, spec, ticket) and each blocker.

- Pickable: open, `ready-for-agent`, no assignee, none of `needs-info` / `ready-for-human` /
  `wontfix`, no open native blocker.
- In flight: open, `ready-for-agent`, assigned to the viewer (@me).
- A top-level SPLIT child shows up as an open blocker of its origin, so the origin never reads as done.

Refusal rule: a failed query, unparseable output, or a truncated page means refuse to start or
pause the run — it is never interpreted as "done" or as an empty queue.

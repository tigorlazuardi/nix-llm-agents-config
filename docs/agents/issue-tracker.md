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

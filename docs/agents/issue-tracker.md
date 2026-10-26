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

Harness tools run this repo's queue by executing the commands in the fenced blocks below.
A command prints exactly one non-negative integer — the count for its queue — and exits 0
whenever its query succeeded, including a count of 0. Every fetch carries an explicit
`--limit 500`; a result that hits the ceiling may be truncated, so the command exits 1
instead of reporting a count it cannot vouch for (covered by the refusal rule below).

- `drain-queue`: count of pickable issues — open, labeled `ready-for-agent`, no assignee, and no
  open native blockers (`blocked_by` from `.issue_dependencies_summary`; `needs-info`,
  `ready-for-human`, and `wontfix` never qualify). The command enforces the exclusions itself:
  any fetched issue that also carries one of those labels, or that has an assignee, is dropped
  before counting.
- `drain-inflight`: count of open `ready-for-agent` issues assigned to @me (claimed or in progress).

Refusal rule: a missing block, non-zero exit, or non-numeric output means refuse to start or
pause the run — it is never interpreted as "done" or as an empty queue.

```drain-queue
set -euo pipefail
# A fetch capped at the limit may be truncated; refusing beats printing a plausible wrong count.
# ponytail: fixed to a 500-item fetch ceiling; switch to `gh --paginate` (count server-side) when a queue can legitimately reach 500.
if [ "$(gh issue list --state open --label ready-for-agent --limit 500 --json number --jq 'length')" -eq 500 ]; then
  exit 1
fi
open_ready="$(gh issue list --state open --label ready-for-agent --limit 500 --json number,labels,assignees --jq '[.[] | select((.assignees | length) == 0 and (([.labels[].name] | index("needs-info") // index("ready-for-human") // index("wontfix")) == null)) | .number] | .[]')"
count=0
for number in $open_ready; do
  blocked="$(gh api "repos/{owner}/{repo}/issues/$number" --jq '.issue_dependencies_summary.blocked_by')"
  # A non-numeric answer means the query broke; aborting beats silently counting the issue as unblocked.
  case "$blocked" in ''|*[!0-9]*) exit 1 ;; esac
  if [ "$blocked" -eq 0 ]; then count=$((count + 1)); fi
done
echo "$count"
```

```drain-inflight
set -euo pipefail
count="$(gh issue list --state open --label ready-for-agent --assignee @me --limit 500 --json number --jq 'length')"
# Same fetch ceiling as drain-queue: a count that hits the limit may be truncated, so refuse.
# ponytail: fixed to 500; switch to `gh --paginate` when the queue can legitimately reach 500.
if [ "$count" -eq 500 ]; then exit 1; fi
echo "$count"
```

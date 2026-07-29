---
name: tuxedo-todo
description: Use whenever the user asks "what's pending / what's left / any todos", when a todo.txt exists in the working repo or at $TODO_FILE, or when the user mentions tuxedo. Surfaces unfinished durable tasks, marks them done, and adds new ones via the tuxedo CLI (a keyboard-driven TUI/CLI for the todo.txt format). Keeps cross-session obligations from being lost after context compaction.
---

# Tuxedo todo (todo.txt manager)

`tuxedo` is a fast, keyboard-driven TUI **and** scriptable CLI for the standard
[todo.txt](https://github.com/todotxt/todo.txt) format
([webstonehq/tuxedo](https://github.com/webstonehq/tuxedo)). It reads one
todo.txt file — `$TODO_FILE` if set, else `./todo.txt` in the repo, else
`~/todo.txt`. That file is durable memory for multi-session obligations: things
that must survive context compaction and a fresh session.

## todo.txt format (what to parse)

One task per line. Examples:

```
(A) 2026-06-19 Restore library from backup +project @context due:2026-06-22
x 2026-06-20 2026-06-19 Restore library from backup +project @context
```

- `x ` prefix  → **DONE** (first date after `x` = completion date).
- `(A)`–`(Z)`  → priority. `(A)` = do first.
- leading `YYYY-MM-DD` → creation date.
- `+project`   → project tag.
- `@context`   → context tag.
- `due:YYYY-MM-DD` → deadline.

**Incomplete = any non-blank line NOT starting with `x `.**

## When triggered

1. Locate the file: `$TODO_FILE`, else `todo.txt` in the working repo, else
   `~/todo.txt`. If none exists, say so and stop — do not create one unprompted.
2. List **incomplete** lines (skip `x `-prefixed and blank), highest priority
   first ((A) before (B) before unprioritized). Show due dates; flag any `due:`
   past today.
3. Remind concisely. Example:
   > Pending todo (2): (A) Restore library from backup; (B) verify restore.
4. Nothing incomplete → say "todo clear" and stop. Do not nag.

`tuxedo ls` prints the list directly; prefer it over hand-parsing when the binary
is on PATH.

## Marking done

Never silently edit the list. When the user confirms a task is finished (or you
just completed work that clearly matches an open line), OFFER to mark it:

- Preferred: `tuxedo do <n>` (n = line number from `tuxedo ls`).
- Or edit the file directly: prefix the line with `x ` + today's date, e.g.
  `x 2026-06-20 2026-06-19 Restore library from backup +project @context`.

## Adding tasks

`tuxedo add "Do the thing +project @context due:YYYY-MM-DD"`, or append a
todo.txt-format line directly. Keep the leading creation date (`YYYY-MM-DD`).

## Interactive use

Bare `tuxedo` launches the TUI (vim-style keys, themes, search, command palette).
That is for the human — in an agent loop use the one-shot CLI subcommands
(`ls`, `add`, `do`) so output is scriptable.

## Committing

If the todo file lives in a git repo, treat changes (new tasks, completions) like
any other edit: stage/commit when the user commits. Do not commit on your own
unless asked.

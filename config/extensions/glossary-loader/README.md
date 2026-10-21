# glossary-loader

Pi extension. The harness, not the LLM, loads the nearest `GLOSSARY.md` for the folder being worked in. Read-only: it never writes to the target repo.

## Behaviour

1. A `read`, `edit`, `write`, `ls`, `find`, or `grep` tool call names a path. `ls`/`find`/`grep` without a path mean the session cwd.
2. Start at that path's folder (the path itself if it is a folder). Relative paths resolve against the session cwd.
3. Look for `GLOSSARY.md` there, then in each parent folder.
4. Stop after checking the folder that contains `.git` (file or directory, so git worktrees work). The repo root is checked.
5. Nearest `GLOSSARY.md` wins; glossaries are not stacked.
6. No `GLOSSARY.md` up to the repo root, or no `.git` above the path at all (outside any repo): silent no-op. No error, no message.

## Decisions

- **Hook: `tool_call`.** The touched path is known only at call time, so system-prompt injection cannot work and would bust the prompt cache. `tool_result` would alter tool output (pix-* hash anchors). The handler never blocks, never edits tool input, never throws.
- **Delivery:** `pi.sendMessage({ customType: "glossary", display: false }, { deliverAs: "steer" })`. A separate custom message in the transcript. While the agent streams, pi queues it after the current tool batch and before the next model request, so tool-call/tool-result ordering stays valid. It is hidden in the UI, visible to the model.
- **Dedup key:** absolute `GLOSSARY.md` path. State is rebuilt from the session branch on `session_start` (so resume, fork, tree are correct) and on `session_compact`. A glossary summarized away by compaction is therefore loaded again on the next touch; one still inside the kept window is not.
- **Outside a repo = "none".** Never walks to `/` hunting for a glossary.
- **Not parsed:** `bash` commands. Not reloaded: a `GLOSSARY.md` edited mid-session (dedup is by path). Files over 64 KiB are skipped silently.

## Enable

Default-on through the Home Manager module (`programs.pi-coding-agent.extensions.glossary-loader`, linked to `<configDir>/extensions/glossary-loader`). Apply with `home-manager switch` from this flake.

Try it without switching: `pi -e /path/to/config/extensions/glossary-loader/index.ts`.

## Check

`node --experimental-strip-types glossary-loader.self-check.ts` (also `nix build .#checks.<system>.glossary-loader`).

---
name: promote-skills
description: Promote a durable, intent-triggered lesson or cross-domain concept into a repo `.pi/skills/<name>/SKILL.md` so future sessions recall it and pi auto-loads it. Use for abstract knowledge NOT cleanly scoped to file paths — vendor quirks, lessons learned, cross-cutting gotchas, operational constraints — e.g. "vendor X server enters maintenance 2–4am weekends, reject clients then". OFFER this whenever durable knowledge surfaces that a future cold session would otherwise forget, instead of silently absorbing it. Also triggers on "/promote-skills", "make this a skill", "remember this for the project".
---

# Promote durable knowledge into a project skill

Turn an abstract, intent-triggered lesson into a committed `.pi/skills/<name>/SKILL.md` so future cold sessions recall it. Skills trigger on the LLM's intent matching the `description`, not on file paths.

**Location policy (default repo-level):** save to repo `.pi/skills/<name>/SKILL.md` unless the user EXPLICITLY asks for user-level. Repo-level `.pi/skills/` is shared with the team and travels with the repo, auto-loaded by pi. User-level (`~/.pi/agent/skills/`) is machine-local and pi-only. Assume repo-level unless told otherwise.

## Use a skill (not a rule) when

- Knowledge is abstract / cross-domain / operational.
- It cannot be cleanly scoped to file-path globs.
- It is a lesson learned, vendor quirk, gotcha, or constraint a future session would forget.

If the concept IS concrete + path-scopable → **stop, suggest `/promote-rules` instead**.

## Cross-machine note (the whole point)

Auto-memory and `~/.pi/agent/skills/` are **machine-local**. A **project-level skill committed to git** (`.pi/skills/<name>/`) travels with the repo, so it works on every machine and teammate that clones it — intent-triggered memory that crosses machines. This is the default and is what cross-machine persistence relies on.

## Workflow

Load `writing-for-agents` before drafting or editing any skill.

1. **Identify the concept.** State the durable knowledge in 1–2 sentences. Confirm with the user if fuzzy.

2. **Confirm it is skill-shaped.** Abstract / intent-triggered / no clean path scope? If it is actually path-scopable → suggest `/promote-rules`, stop.

3. **Resolve target dir.** Default is repo-level; only go user-level on explicit request.
   - **Project, committed (DEFAULT)** (`.pi/skills/<name>/SKILL.md`) — cross-machine, shared via git. Use unless the user explicitly asks otherwise.
   - **User-level (explicit only)** (`~/.pi/agent/skills/<name>/`) — all your projects on *this machine only*, pi-only; not cross-machine unless you sync dotfiles. Use ONLY when the user explicitly asks for user/global level.
   - No repo? Only user-level applies (mention that committing needs a repo).

4. **Reuse-first.** Search existing `<root>/.pi/skills/*/SKILL.md` (or `~/.pi/agent/skills/*/SKILL.md` for user-level). If one already covers this domain (same vendor/subsystem), append a section to it. Else create a new `<name>/SKILL.md` (kebab-case, e.g. the vendor name).

5. **Draft frontmatter.** `name` + a trigger-optimized `description`. The description IS the trigger — write it so a future session self-invokes when it hits this situation:
   ```
   ---
   name: acme-vendor
   description: Operational quirks of the ACME billing API. Use whenever integrating, calling, or debugging ACME endpoints. Notably the server enters maintenance 02:00–04:00 weekends — reject or queue client calls in that window.
   ---
   ```

6. **Draft the body.** What was learned, why it matters, how to act on it. Concrete beats abstract.

7. **Preview → approval.** Show the full file + target path. Get explicit OK.

8. **Write + confirm.** Write the file. Print the path.

9. **Commit if project-level** (this is what makes it cross-machine). Offer to commit so it actually travels:
   ```
   git add .pi/skills/<name>/
   git commit -m "Add <name> skill"
   ```
   Without the commit it stays local to this checkout — defeating the cross-machine goal. Get the user's ok before committing.

## Keep skills tight

- The `description` carries the trigger — spell out the situation that should summon it. Undertriggering is the common failure — err toward triggering.
- Body = actionable knowledge, not a journal.
- One domain per skill folder; append to an existing folder before spawning a near-duplicate.

## Notes

- A new skill is listed **next session** (skills load at session start). Mention it won't fire mid-session.

---
name: agents-load
description: 'Runtime behavior for lazy-loading AGENTS.md knowledge files. Load this skill when a project has a .agents/ knowledge system and you need guidance on which files to read for the current task. Ensures AI models load only relevant knowledge files instead of everything upfront.'
license: MIT
allowed-tools: Read
---

# Agents Load — Lazy-Load Runtime Behavior

## Overview

This skill governs how to interact with a project's `.agents/` knowledge system. The system is designed so that AI models **never load all knowledge files upfront** — only what is relevant to the current task.

## Session Start Protocol

At the start of every session:

1. Read `AGENTS.md` — it is the navigation map (always small, ~50 lines)
2. Do **not** read any `.agents/*.md` files yet
3. Wait until the task is clear before loading knowledge files

## Before Writing Any Code

Always follow this sequence:

1. Read `.agents/index.md` — it is an index, not the rules themselves
2. From that index, identify which rule file(s) apply to the current task
3. Read only those rule files from `.agents/rules/`
4. Then proceed with the task

**Minimum baseline:** `.agents/rules/general.md` must always be loaded before writing any code, regardless of task type.

## Domain Knowledge Loading

Load domain knowledge files (`.agents/*.md`) only when the task explicitly touches that domain. Use the trigger table in `AGENTS.md` to decide. When in doubt:

- Task is about DB schema, ORM, migrations → load `.agents/database.md` (or equivalent)
- Task is about API routes, service layer → load `.agents/api.md` (or equivalent)
- Task is about UI components, styling → load `.agents/ui-package.md` (or equivalent)
- Task is about auth, permissions → load `.agents/auth-design.md` (or equivalent)
- Task is about deployment, CI/CD → load `.agents/architecture.md` (or equivalent)
- Task is about Plane/project management → load `.agents/plane.md` (or equivalent)

If a task spans multiple domains (e.g. "add a new API route that writes to DB and updates the UI"), load all relevant files at once — do not load them one by one mid-task.

## Post-Compaction / New Session Recovery

After context compaction or in a new session where prior context is lost:

1. Re-read `AGENTS.md` (always)
2. Re-read `.agents/index.md` (always before code)
3. Re-read only the specific rule and knowledge files relevant to the **next immediate task**
4. Do not attempt to reconstruct the full prior context — work from what the current task needs

## Anti-Patterns to Avoid

- ❌ Reading all `.agents/*.md` files at session start "just in case"
- ❌ Reading `.agents/rules/*.md` files without checking `index.md` index first
- ❌ Skipping `.agents/index.md` because the task "seems simple"
- ❌ Re-loading files that are already in the current context window
- ❌ Treating `AGENTS.md` as the place to look for actual rules — it only points to them

## When Knowledge Files Don't Cover the Case

If the task involves something not covered by any knowledge file:

1. Check `design-docs/` if the project has one (mentioned in `AGENTS.md`)
2. Ask the user only if `design-docs/` also doesn't cover it
3. After resolving with the user, suggest updating the relevant knowledge file

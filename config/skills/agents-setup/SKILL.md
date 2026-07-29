---
name: agents-setup
disable-model-invocation: true
description: 'Scaffold a lazy-load AGENTS.md knowledge system for a new project. Use when user says "setup agents", "init agents", "create AGENTS.md", or wants to set up AI knowledge files for a project. Analyzes the project structure and generates a lean AGENTS.md index + .agents/ knowledge files that AI models load on-demand.'
license: MIT
allowed-tools: Read, Write, Bash, Glob
---

# Agents Setup — Lazy-Load Knowledge Scaffold

## Overview

This skill scaffolds a **lean AGENTS.md + .agents/ knowledge file system** for any project. The goal: AI models read a minimal AGENTS.md on every session, then load only the knowledge files relevant to the current task — keeping context lean and retrieval sharp.

## Pattern

```
AGENTS.md              ← Minimal index (~50 lines). Always read.
.agents/
  index.md        ← Rules index. Always load before writing code.
  rules/
    general.md         ← Always load for any code change
    <domain>.md        ← Load only when task touches that domain
  <knowledge>.md       ← Load only when task touches that domain
```

**Key principle:** `AGENTS.md` is never a dump of everything. It is a navigation map.

---

## Workflow

### Step 1: Analyze the Project

Before generating anything, explore the project to understand:

1. **Project type** — What kind of app/library is this? (web app, CLI, API, monorepo, etc.)
2. **Tech stack** — Languages, frameworks, runtimes, key libraries
3. **Monorepo structure** — Apps, packages, workspaces (if any)
4. **Existing conventions** — Any existing AGENTS.md, CLAUDE.md, .cursorrules, README patterns
5. **Domain knowledge areas** — What topics an AI would need to know to work on this project

Run these to gather context:

```bash
ls -la
cat package.json 2>/dev/null || cat pyproject.toml 2>/dev/null || cat Cargo.toml 2>/dev/null
ls apps/ packages/ src/ 2>/dev/null
cat README.md 2>/dev/null | head -60
```

Also glob for existing config files: `**/{AGENTS,CLAUDE,CURSOR,.cursorrules,GEMINI}*`

### Step 2: Identify Knowledge Domains

Based on project analysis, identify 4–8 knowledge domains. Common ones:

| Domain | Typical content |
|--------|----------------|
| `architecture` | Deployment model, package boundaries, data flow |
| `database` | Schema, ORM conventions, migrations, naming |
| `api` | Route patterns, auth, request/response shape |
| `ui` | Component library, design system, styling rules |
| `auth` | Session strategy, permissions, middleware |
| `testing` | Test patterns, coverage expectations, tooling |
| `deployment` | CI/CD, environments, secrets management |
| `tech-stack` | Library choices, version constraints, env vars |

### Step 3: Identify Hard Rules

Hard rules are conventions that apply to code writing — things that are easy to get wrong and have concrete do/don't form. Group them into rule files under `.agents/rules/`:

- `rules/general.md` — Always applies (imports, naming, package constraints)
- `rules/<domain>.md` — Domain-specific rules (e.g., `rules/database.md`, `rules/api.md`, `rules/svelte.md`)

### Step 4: Present Plan to User

Before generating files, present:

- Which knowledge files will be created and what they'll cover
- Which rule files will be created
- Ask if any domains are missing or should be renamed

Wait for approval before generating.

### Step 5: Generate Files

Generate in this order:

1. `.agents/rules/general.md` — Always-applicable rules
2. `.agents/rules/<domain>.md` — Per-domain rules
3. `.agents/index.md` — Index pointing to rule files
4. `.agents/<knowledge>.md` — Knowledge files per domain
5. `AGENTS.md` — The lean index tying everything together

---

## AGENTS.md Template

```markdown
# <Project Name>

<One sentence: what this project is and what it does.>

## Structure

\`\`\`
<monorepo or src tree — keep to ~15 lines max>
\`\`\`

<Namespace or naming conventions, if any.>

## Design Decisions

When uncertain about design — read `<design-docs-folder>/` first before asking the user:

| File | Covers |
| ---- | ------ |
| ...  | ...    |

*(Remove this section if no design-docs folder exists.)*

## Knowledge Files (Lazy Load)

**Do not load all knowledge files upfront.** Read only the file(s) relevant to the current task:

| File | Load when task involves... |
| ---- | -------------------------- |
| `.agents/architecture.md` | deployment, package structure, data flow |
| `.agents/tech-stack.md`   | choosing libraries, env vars, secrets |
| `.agents/database.md`     | schema, ORM, migrations |
| `.agents/api.md`          | routes, auth middleware, request shape |
| ...                      | ...                       |

> **Rule:** Before writing any code, always load `.agents/index.md` — it is an index that tells you which rule file(s) to load. Load domain knowledge files only when the task touches that domain.
```

---

## index.md Template

```markdown
# Hard Rules — Index

Before writing any code, load the rule files relevant to the current task:

| File | Load when task involves... |
| ---- | -------------------------- |
| `.agents/rules/general.md`  | any code change — naming, imports, constraints |
| `.agents/rules/database.md` | DB schema, ORM, migrations, query naming |
| `.agents/rules/api.md`      | routes, services, validation schemas |
| `.agents/rules/ui.md`       | components, styling, design tokens |

> **Minimum baseline:** Always load `.agents/rules/general.md` for any code change.
> Load others only when the task touches that domain.
```

---

## Quality Checklist

Before finishing, verify:

- [ ] `AGENTS.md` is under 60 lines
- [ ] Each knowledge file covers exactly one domain — no overlap
- [ ] `index.md` is an index only — no actual rules in it
- [ ] Every rule file has `rules/general.md` always-load note
- [ ] Rules are concrete (do/don't), not vague guidelines
- [ ] Trigger descriptions in the index tables are specific enough that AI can decide without reading the file
- [ ] No design decisions or rules are duplicated across files

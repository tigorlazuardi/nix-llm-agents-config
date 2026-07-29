---
name: agents-update
description: 'Add or update knowledge files and rules in an existing .agents/ system. Use when user says "add a rule", "update agents", "add knowledge file", "document this convention", or wants to capture a new decision/rule into the project knowledge base. Follows the lazy-load pattern — touches only the minimal files needed.'
license: MIT
allowed-tools: Read, Write, Glob
---

# Agents Update — Add or Update Knowledge Files & Rules

## Overview

This skill adds new rules or knowledge to an **existing** `.agents/` system without bloating it. The lazy-load pattern must be preserved: every addition goes into the **most specific, smallest scope** possible.

---

## Decision Tree: Where Does This Belong?

Before writing anything, ask:

```
Is it a hard rule (concrete do/don't for code)?
  ├─ Yes → .agents/rules/<domain>.md
  │         If new domain → create new rule file + update index.md index
  │
  └─ No → Is it domain knowledge (how something works, design decisions, IDs/config)?
            ├─ Yes → .agents/<domain>.md
            │         If new domain → create new knowledge file + update AGENTS.md index
            │
            └─ No → Does it belong in AGENTS.md itself?
                      (Only: project overview, monorepo structure, design-docs index, knowledge index)
                      ├─ Yes → Edit AGENTS.md minimally
                      └─ No → Ask user to clarify scope
```

**Rules of thumb:**
- Concrete, actionable do/don't → `.agents/rules/`
- Context, background, how-it-works → `.agents/<domain>.md`
- IDs, config values, workflow steps → `.agents/<domain>.md`
- Never put content in `.agents/index.md` itself — it is index-only

---

## Workflow

### Step 1: Read Current Structure

Always start by reading the existing index files:

```
Read: AGENTS.md
Read: .agents/index.md
```

This tells you what files exist and what they cover. Do **not** read all knowledge files — only the ones relevant to the update.

### Step 2: Identify the Target File

Based on the user's request and the decision tree above:

- If updating an **existing** rule/knowledge file → read that file, then edit it
- If creating a **new** rule file → also update `.agents/index.md` index
- If creating a **new** knowledge file → also update `AGENTS.md` index table

### Step 3: Read the Target File

Read the specific file that will be modified. Do not read others.

### Step 4: Make the Minimal Change

**For adding to an existing file:**
- Find the correct section
- Add the new rule/knowledge in consistent style with surrounding content
- Keep it concrete — rules should be do/don't, not vague guidelines

**For creating a new rule file:**
- Follow this structure:
  ```markdown
  # Rules: <Domain>

  ## <Rule Topic>

  <Concrete description. What to do, what never to do, why if non-obvious.>

  ## <Another Rule Topic>
  ...
  ```
- Then add one line to `.agents/index.md` index table

**For creating a new knowledge file:**
- Follow this structure:
  ```markdown
  # <Domain Title>

  ## <Section>

  <Context, decisions, config values, how it works.>
  ```
- Then add one line to `AGENTS.md` knowledge index table with a precise trigger description

### Step 5: Verify Consistency

After making changes, check:

- [ ] No content duplicated across files
- [ ] Index tables in `AGENTS.md` and `index.md` are accurate
- [ ] New rule files are listed in `index.md` with correct trigger description
- [ ] New knowledge files are listed in `AGENTS.md` with correct trigger description
- [ ] Trigger descriptions are specific enough to decide without reading the file
- [ ] `AGENTS.md` is still under 60 lines
- [ ] `.agents/index.md` is still index-only (no actual rules in it)

---

## Index Entry Format

When adding to `AGENTS.md` knowledge table:
```
| `.agents/<name>.md` | <verb phrase describing when to load, e.g. "auth, sessions, permissions, middleware chain"> |
```

When adding to `.agents/index.md` index:
```
| `.agents/rules/<name>.md` | <verb phrase, e.g. "DB schema, ORM, migrations, query naming"> |
```

Trigger descriptions should be **comma-separated keywords or short phrases** — specific enough that AI can match them to the current task at a glance.

---

## Anti-Patterns

- ❌ Putting a rule directly in `.agents/index.md` (it's an index)
- ❌ Putting rules in a knowledge file (`.agents/*.md` outside `rules/`)
- ❌ Putting knowledge/context in a rule file (`.agents/rules/*.md`)
- ❌ Creating a catch-all `.agents/rules/misc.md` — if it doesn't fit, reconsider the domain split or ask the user

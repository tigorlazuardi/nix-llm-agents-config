---
description: Materialize ten machine-local drain agents from an approved contract
argument-hint: "[agent setup hints]"
skill: writing-great-skills
---
Drain agent setup: $@

# Setup Drain Agents

Setup only. Read `~/.pi/agent/templates/drain/AGENTS.md` and its `REFERENCE.md` context pointer before authoring. Those references own role behavior; this prompt owns ordered materialization.

## 1. Doctor

Resolve trusted Git root/common dir, `.pi/drain/contract.json`, generated prompt/hash binding, applicable project instructions, installed models/tools/extensions/skills, and existing `.pi/agents/drain/`.

Require approved contract before provider-specific tool binding. Missing contract points to `/drain-wizard`; invalid hash points back there for regeneration.

**Complete when:** contract/provider/SCM capabilities and every required model/tool/private-skill source are inventoried, with exact gaps.

## 2. Materialize proposal

Generate exactly the ten agents in `AGENTS.md` under `.pi/agents/drain/`. Frontmatter and body follow that reference; resolved ids, branches, budgets, and URLs remain in contract.

Bind provider/tracker/SCM/deployment tools only to delivery/housekeeper. Bind `subagent` only to delivery/build-lead. Keep all other agents leaves. Copy selected UI/UX/writing skill sources into `.pi/drain/skills/<agent>/` and use relative `skillPath` plus explicit `skills`; local candidates stay outside parent/global discovery.

Tool/skill absence fails the affected agent instead of silently weakening it. Promotion tools are optional for note-taker; durable candidates still land in report when absent.

**Complete when:** ten proposed files resolve runtime names, models, thinking, tool allowlists, depth, acceptance role, private skills, contract pointer, and strict terminal schema with no unresolved placeholder.

## 3. Preview and write

Show generated file list, exact agent/model/tool/skill matrix, and redacted diffs. Existing targets require explicit overwrite approval. Re-read targets immediately before write; drift cancels approval.

Write atomically. Add clone-local Git exclude entries without changing committed `.gitignore`:

```text
/.pi/agents/drain/
/.pi/drain/
```

**Complete when:** all files match approved proposal and shared repository files remain unchanged.

## 4. Smoke

Run live subagent discovery. Confirm exactly ten local runtime names resolve to expected paths/models. Inspect frontmatter mechanically: only two fanout agents, every leaf lacks `subagent`, outward tools exist only on delivery/housekeeper, and private skills resolve.

Spawn no delivery work. Write `.pi/drain/agent-setup-report.md` with contract hash, generated files, matrix, and checks.

**Complete when:** ten agents discover cleanly, all invariants pass, generated paths are ignored, and tracker/SCM mutation count is zero.

Return exactly:

```text
SETUP: PASS|BLOCKED
CONTRACT_REF: .pi/drain/contract.json|none
AGENT_ROOT: .pi/agents/drain|none
REPORT_REF: .pi/drain/agent-setup-report.md|none
NEXT: /drain-wizard to re-smoke, then /drain .pi/drain/DRAIN-PROMPT.md
```

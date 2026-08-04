---
description: Configure or edit one machine-local ticket drain
argument-hint: "[existing contract or setup hints]"
skill: writing-great-skills
---
Drain wizard request: $@

# Drain Wizard

Setup/edit only. Produce a brownfield mapping, contract, and provider-specific runtime prompt; execute no drain work.

Read `~/.pi/agent/templates/drain/REFERENCE.md` before interviewing. Use
`contract.template.json` for shape, `contract.schema.json` and `state-event.schema.json` for validation, and `DRAIN-PROMPT.template.md` for runtime output. Those files are the reference; keep this prompt procedural.

Agent setup/edit is conditional. Inspect discovery first; do not load `~/.pi/agent/templates/drain/AGENTS.md` unless one of the ten drain agents is missing/drifted or the user requested agent changes.

## 1. Doctor the current system

Inspect Git common dir, remote/SCM, checks, coding standards, tracker docs, authenticated tracker/SCM tools, optional existing notifier/destination, every candidate project, existing statuses/fields/labels, blocking relation, branches, environments, pipelines, existing `.pi/drain/contract.json`, and generated drain agents.

For an existing contract, compare every remote id/name/capability with current reality. Preserve valid mappings; list drift rather than silently repairing it.

**Complete when:** one redacted inventory names every discovered project, role candidate, work-contract source, branch/environment, tool capability, missing agent, and drift item. Unsupported access is explicit.

## 2. Map brownfield roles

Interview one section at a time. Lead with observed recommendation; skip settled sections.

For each project map `ready`, `inProgress`, `review`, `needsHumanReview`, and `done` to existing tracker constructs. Map authoritative work-contract source and human-comment context. Reuse composites before proposing a new operational marker.

When a required role has no safe mapping, offer the smallest new status/field/label. Collect remote mutations separately; apply none yet.

**Complete when:** every project has one unambiguous selector/transition per semantic role, one work-contract extractor, one blocker relation, and no proposed addition lacks a reason.

## 3. Define ordered lanes

Build ordered `hotfixPolicies[]` first, then ordered `policies[]`. Multiple tracker projects are allowed; operator guarantees one vertical product.

For every lane resolve project scope, matcher, source branch, branch pattern, MR target, completion gate, deployment environment/trigger, and deploy-fix behavior. First matching lane wins; tickets within tiers are oldest first.

Hotfix lane uses production source → reviewed cherry-pick to development/staging → deployment green → upstream MR to production. Full review remains mandatory. Standard deployment code fixes use follow-up MRs. Both use deploy-fix budget 2.

Classify deployment environments from provider/CI evidence. `autoDeploy` may be offered only for proven development/staging targets. Unknown or production-like targets are human-only.

Map continuous bounded housekeeping rounds. Recommend `pollSeconds: 60`, `roundWindowSeconds: 900`, and one active round. Notifications are optional: when requested, resolve one installed notifier plus destination and collect per-repo `remindAfterSeconds`/`repeatEverySeconds` (defaults 7200/86400). Otherwise write `notifications: null`. Load detailed reconciliation/reminder semantics from `REFERENCE.md`; do not restate them here.

**Complete when:** every lane resolves to real branches/provider operations, housekeeping cadence is bounded, optional notifier refs resolve without credentials, at least one normal lane exists, overlaps are visible by array order, and no automated path reaches production or auto-merge.

## 4. Preview mutations

Show:

1. semantic-role mapping per project;
2. authoritative ticket-context source;
3. hotfix and normal lane order/matchers;
4. branch/MR/deployment flow;
5. ledger, budgets, resume, housekeeping round/cadence, optional reminder policy, and failure transitions;
6. exact remote statuses/labels/fields proposed for creation;
7. local files created/changed and redacted diffs.

Ask approval for remote additions first. Immediately re-read remote state; drift cancels approval. Create only approved missing constructs, capture returned stable ids, then re-run role mapping.

**Complete when:** remote state exactly supports the approved mapping and every addition has a stable id. Rejection leaves remote untouched and setup blocked.

## 5. Materialize atomically

Fill every placeholder in `contract.template.json`. Validate exact keys, project references, first-match lanes, branch existence, role distinguishability, work-contract extraction against one sampled ticket, provider operations, bounded housekeeping cadence, optional notifier capability/destination, non-production autoDeploy guard, and secret absence.

Generate `.pi/drain/DRAIN-PROMPT.md` from `DRAIN-PROMPT.template.md`. Materialize provider/SCM operations, optional notification operation or explicit disabled marker, and lane branches, but keep ids, branches, budgets, and state mappings referenced from sibling contract. Compute contract SHA-256 and bind it in prompt frontmatter.

Preview both files. Ask one write/overwrite approval. Re-read targets immediately; drift cancels approval. Write contract then prompt via temp+rename. Add these clone-local Git exclude entries without disturbing others:

```text
/.pi/agents/drain/
/.pi/drain/
```

**Complete when:** files parse, prompt hash equals contract hash, paths are ignored, and no shared repo file changed.

## 6. Materialize agents when needed

Run live discovery for the ten drain agents. When all resolve and no agent edit was requested, leave them untouched. Otherwise read complete `~/.pi/agent/templates/drain/AGENTS.md` and follow its conditional materialization procedure. Do not duplicate that procedure here.

**Complete when:** existing agents remain untouched, or the reference procedure finishes with ten valid machine-local agents. A blocked setup blocks the wizard.

## 7. Smoke

Run read-only candidate queries for every project. Reconstruct one sampled ledger if present. Confirm ordered selection can distinguish resumable, hotfix, normal, blocked, and unmatched tickets without mutation. Dry-run housekeeping scope plus reminder due/dedupe decisions without sending. Confirm ten drain agents resolve.

Write `.pi/drain/setup-report.md` with redacted mappings, hashes, agent result, Doctor results, and timestamp.

**Complete when:** every mapped remote object resolves, candidate query succeeds, contract/prompt binding passes, ten agents resolve, and mutation count during smoke is zero.

Return exactly:

```text
WIZARD: PASS|BLOCKED
CONTRACT_REF: .pi/drain/contract.json|none
PROMPT_REF: .pi/drain/DRAIN-PROMPT.md|none
AGENTS: UNCHANGED|MATERIALIZED|BLOCKED
REPORT_REF: .pi/drain/setup-report.md|none
NEXT: /drain .pi/drain/DRAIN-PROMPT.md|fix-blocker-and-rerun-drain-wizard
```

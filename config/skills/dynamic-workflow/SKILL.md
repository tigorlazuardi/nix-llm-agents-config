---
name: dynamic-workflow
description: >-
  Scaffold a spec-ingesting orchestration script for the DYNAMIC-WORKFLOW sweep flow
  (@quintinshaw/pi-dynamic-workflows) in FASE 2, after the user has explicitly picked the "dynamic-workflow"
  orchestration level and a spec + design docs already exist. Use for WIDE, REPETITIVE, SAFE-only
  sweep work — OTel traces everywhere, logs to a new standard, failable error-feedback on all UI
  interactions, a11y/telemetry sweeps. Trigger on "make a dynamic-workflow", "fan out this instrumentation",
  "sweep the codebase for X", "author a workflow script". Produces a JS orchestration script whose
  every agent() prompt bakes the FASE-1 conventions (metric naming, log format, error-feedback
  standard) and whose workers are CAPPED at safe tiers (`<vertical>-worker` + `<vertical>-reviewer`,
  NEVER `<vertical>-frontier-worker` / `<vertical>-frontier-reviewer`). This skill authors the SCRIPT only; it does NOT run it.
  NEVER use dynamic-workflow for any low-tolerance surface (auth/secrets/migration/schema/money/data-deletion).
---

# Dynamic-workflow — scaffold a `pi-dynamic-workflows` orchestration script

`@quintinshaw/pi-dynamic-workflows` runs **"code mode for subagents"**: the main agent writes a JS
orchestration script that fans out `agent()` / `parallel()` subagents (≤16 concurrent / 1000 total,
**in-process** via `createAgentSession` — no pi subprocess), holding intermediate results in script
variables so the main chat context stays clean. The run is background by default; a live panel tracks
it and delivers the synthesized result back when done.

The **orchestration script** IS the dynamic-workflow contract. This skill authors one from the approved spec +
design docs. You (main agent) author it PRE-run. You do NOT run it — the user's explicit `/workflows
run` (FASE 2) starts it.

## When dynamic-workflow is the RIGHT flow (and when it is NOT)

Dynamic-workflow is **breadth-of-SAFE-work**, not depth, not risk. Use it only when BOTH hold:

- **Shape:** wide, repetitive, independent, same-pattern tasks (instrument N services, add a log line
  to N handlers, add failable error-feedback to N UI interactions, a11y sweep across N components).
- **Safety:** the scope touches **NO low-tolerance surface** — no auth / secrets / DB migration /
  schema / public-API / money-payment / data-deletion / irreversible work.

If either fails → this is the WRONG flow:
- Low-tolerance present → route to **supervise** (never dynamic-workflow).
- Heavy inter-dependency between parts → route to **supervise**.
- Single deep sequential slice → **direct or supervise**.

Confirm this safety-first split before scaffolding.

## Preconditions

1. The user has already chosen the **dynamic-workflow** level (FASE 2) via the hard human gate. If not, stop — the
   level decision is a FASE-1 main-agent recommendation the user must confirm, not this skill's job.
2. A **spec + design docs** already exist (FASE 1 output). The script's phase-1 discovery ingests them
   and every worker prompt bakes their conventions; the script never authors the spec. No spec → stop
   and route back to FASE-1 planning.
3. **Safety gate passed** — you have confirmed the scope is free of any low-tolerance surface. If a
   low-tolerance concern exists, REJECT dynamic-workflow here and offer supervise.
4. Keyword auto-trigger is OFF (`~/.pi/workflows/settings.json` → `keywordTriggerEnabled: false`).
   Dynamic-workflow runs only via explicit `/workflows run`.

## Orchestration-script primitives (pi-dynamic-workflows)

```js
export const meta = {
  name: 'otel_trace_sweep',
  description: 'Add OTel spans to every service handler per the approved telemetry spec',
  phases: [{ title: 'Discover' }, { title: 'Instrument' }, { title: 'Verify' }],
}

// Vertical is NEVER hardcoded and NEVER defaults silently — it must come from a required
// script arg (pass it via `/workflows run` args, e.g. { vertical: 'codex' }). Dynamic-workflow is
// standard tier only, never frontier, for either vertical.
if (args.vertical !== 'claude' && args.vertical !== 'codex') {
  throw new Error(`args.vertical must be 'claude' or 'codex', got: ${JSON.stringify(args.vertical)}`)
}
const workerAgentType = `${args.vertical}-worker`
const reviewerAgentType = `${args.vertical}-reviewer`

phase('Discover')
const targets = await agent('List every handler file under src/services/.', { tier: 'small' })

phase('Instrument')
const results = await parallel(
  targets.split('\n').filter(Boolean).map((file) =>
    () => agent(INSTRUMENT_PROMPT(file), { agentType: workerAgentType, isolation: 'worktree' }),
  ),
)

phase('Verify')
return await agent(VERIFY_PROMPT(results), { agentType: reviewerAgentType, tier: 'big' })
```

- `agent(prompt, opts)` — spawn one isolated subagent; returns its text (or a validated object with
  `opts.schema`). Recoverable failure → `null` with diagnostics in `/workflows`.
- `parallel(thunks)` — run `() => agent(...)` thunks concurrently; results in input order.
- `pipeline(items, ...stages)` — fan items through sequential stages.
- `phase(title, { budget? })` — group agents in the live view.
- `verify` / `judgePanel` / `loopUntilDry` / `completenessCheck` — built-in quality patterns.
- Agent opts: `tier` (`small`/`medium`/`big`), exact `model`, `agentType` (`.pi/agents/<name>.md`
  binding tools+model+role), `isolation: "worktree"`, `schema`, `label`, `timeoutMs`, `retries`.
- Sandbox: runs in a Node `vm` with no `Date.now()`/`Math.random()`/`fs`/network → reproducible +
  reliable resume. Keep scripts deterministic.

## Authoring rules (mandatory for every dynamic-workflow script)

### 1. Discovery/phase-1 INGESTS the spec, never re-plans
The first agent reads the approved spec + design and enumerates the sweep targets. It must NOT
reinterpret requirements or invent conventions — the spec is authoritative. Point it at the spec path
named in the prompt.

### 2. Every worker prompt BAKES the FASE-1 conventions
This is the core of dynamic-workflow: parallel branches must NOT each improvise their own convention. Build the
worker prompt from the spec so the standard (metric naming, log format, span attributes, label
dimensions, error-feedback contract) is embedded in EVERY `agent()` call. Define a prompt-builder up
top and reuse it:

```js
const SPEC = `<paste the approved conventions: metric names, label set, log schema, span attrs>`
const INSTRUMENT_PROMPT = (file) => `${SPEC}

Apply the above conventions EXACTLY to ${file}. Do not invent metric names, labels, or log keys —
use only those defined above. If ${file} needs a convention not covered by the spec, STOP and report
it (do not guess).`
```

### 3. Worker tier is CAPPED non-critical
Dynamic-workflow is safe-only, so `agentType` / `tier` is capped to worker-model agents: `<vertical>-worker`
(standard/trivial), `<vertical>-reviewer` (review). **NEVER** `<vertical>-frontier-worker` or
`<vertical>-frontier-reviewer`. Dynamic-workflow has no escalate-to-frontier path — if a branch turns out
low-tolerance, the script must STOP that branch and surface it, not upgrade in place.

### 4. Escape hatch on low-tolerance discovery
Worker prompts instruct: if a target touches a low-tolerance surface (auth / secrets / migration /
schema / money / data-deletion), STOP that branch, return a flagged result, and do NOT modify it. The
main agent raises those flags to the user after the run — they get re-routed to supervise, never
auto-handled inside dynamic-workflow.

### 5. Isolation for parallel edits
Any phase where parallel workers edit files uses `isolation: "worktree"` so concurrent branches don't
clobber each other. Read-only discovery/verify phases don't need it.

### 6. Telemetry is part of the sweep's own "done"
When the sweep IS the telemetry work (OTel/log sweeps), the verify phase asserts the conventions
actually landed (spans emitted, metric names match, labels present) — not just that files changed.
Bake the acceptance check into the final `agent()`/`verify()`.

## Workflow

1. Confirm preconditions (dynamic-workflow level chosen; spec exists; safety gate passed). Read the spec + design.
2. Extract the conventions into a `SPEC` constant + prompt-builder(s) (rule 2).
3. Design phases: Discover (ingest spec, enumerate targets) → Instrument/Apply (parallel, worktree) →
   Verify (assert conventions landed).
4. Apply authoring rules 1–6. Capped tiers, baked conventions, escape hatch, worktree isolation.
5. Save the script where the user can re-run it: after a first run, `/workflows save <name>` turns it
   into a reusable `/<name>` command (stored under `~/.pi/workflows`).
6. Preview the script + the launch command to the user. Get approval.
7. Hand off — do NOT start the run yourself:
   ```
   /workflows run <prompt referencing the spec path>
   ```

## This skill is terminal
It authors the orchestration script and stops. Starting `/workflows run` is the user's action (or an
explicit follow-up), mirroring the pre-run / in-run phase boundary — the same boundary the goal
orchestrator keeps between an approved contract and an autonomous run.

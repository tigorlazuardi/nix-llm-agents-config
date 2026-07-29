---
name: fleet-draw
description: >-
  Render a fleet run's current status as one self-contained HTML report — graph view (DAG-of-DAG
  and per-DAG task graph, colored by status), gantt/waterfall view of audit spans, and an error
  list. Trigger on "draw fleet status", "gambar status fleet", "fleet report", "graph fleet run",
  "show fleet progress", "visualize the fleet run", or when the captain wants a human-reviewable
  snapshot of `.fleet/<run>/` (including the graph-preview human gate before dispatch). Source of
  truth for the data shape: docs/design/2026-07-12-fleet-revamp.mdx (§State, §audit[],
  §fleet-draw) and templates/fleet/{fleet,state}.schema.json.
---

# fleet-draw — fleet status report

Deterministic renderer, not an interview. Input: a pointer to a fleet run dir
(`.fleet/<run>/`, containing `fleet.json` + `dags/<id>/state.json`). Output: one self-contained
HTML file — no build step, no server, opens straight from `file://`.

## How to invoke

Prefer spawning the consolidated `fleet-draw` subagent (fixed `cx/gpt-5.6-luna`, scout-tier,
mechanical) so rendering happens off main context. Do not change model or fail over. If running inline instead:

```sh
node ~/.pi/agent/skills/fleet-draw/assets/render.mjs <run-dir> [out.html]
```

- `<run-dir>` = the directory holding `fleet.json` (normally `.fleet/<run>/`).
- Default output: `<run-dir>/report/status-<ISO-timestamp>.html` (dir created if missing).
- The script prints exactly two lines on success: the output path, then a summary line
  (`X/Y task passed, N error span(s), M DAG running`) computed straight from the embedded data.
- Non-zero exit + stderr message = a `state.json`/`fleet.json` is missing or unparsable — surface
  that verbatim, don't patch around it.

## Pointer protocol — anti context-pollution

**Never paste the HTML body, the embedded JSON, or raw `state.json`/`fleet.json` contents into the
conversation.** Return to the caller (captain or user) only:

1. The HTML path (pointer).
2. The two-sentence summary: the counts line the script printed, plus one sentence naming what's
   notable (a failed task, a DAG stuck running, an error span) if the printed counts show one.

This mirrors the fleet-wide rule in the design doc: file = data plane, conversation = control
plane. A status report that gets read back into context defeats its own purpose.

## What the report shows (so you can describe it, not just link it)

- **Graph tab** — two levels: fleet level (node = DAG, click → drills into that DAG's task
  graph) and DAG level (node = task). Topological layering, left→right. Color = status (pending
  gray, running blue, review/fixing yellow, passed green, failed red). DAG nodes badge the judge
  verdict; task nodes badge `fixAttempt` when > 0.
- **Gantt tab** — one row per node, one segment per `audit[]` span (`startedAt`→`endedAt`, or to
  report-generation time if still running, shown striped/pulsing). Segment color = `role`; a
  `status:error` span renders bright red regardless of role.
- **Errors tab** — flat list of every `status:error` span across the whole run, click-through to
  the same detail panel.
- **Detail panel** — click any node or span. A span's `error` (when present) renders verbatim in a
  monospace red block pinned at the top of the panel — never truncated by this renderer (the
  writer-side 2KB truncation + `reportRef` happens upstream, per the audit-span contract).
  `commitSha` renders as a link when `fleet.json.git.webTemplate` is set.

## Known limits

- No browser available in a headless/CI environment to click through — the render script only
  validates structurally (JSON parses, files embed, no external network calls). If you need
  visual confirmation, open the file locally.
- Read `templates/fleet/README.md` + `validate.mjs` if you need to sanity-check a run dir's
  schema before rendering; `fleet-draw` itself does not validate, only reads and embeds.

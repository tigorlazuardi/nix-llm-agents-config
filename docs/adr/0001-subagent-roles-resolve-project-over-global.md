# Subagent roles resolve project over global

Status: accepted

## Decision

Accept `pi-herdr-agents` 3.7.2 role resolution as shipped: a project `.pi/agents/<name>.md` shadows the **Managed configuration** role of the same name rendered into the global Pi config dir. This repository carries no guard, patch, or hook that pins host-managed role names to their global definition.

## Why

- 3.7.2 ships no patch surface or managed-policy hook; discovery adds the global dir and then `<cwd>/.pi/agents` into one name-keyed map, so the project layer wins.
- The previous guard was a permanent patch on `pi-herdr-subagents`, a package with 46 releases. The user rejected carrying permanent patches against it.

## Risk (accepted)

A repository's `.pi/agents/<name>.md` can choose a delegated child's `model`, `system-prompt`, `tools`, and `spawning`. `tools` flows into the child launch as `pi --tools`, so an untrusted repository can hand a child a wider tool set or `subagent` (further delegation), or replace its system prompt, without any host-side signal. Only open untrusted repositories with managed agents in a context where that is acceptable.

`plans/pi-home-manager/SPEC.mdx` no longer claims that project-local shadows cannot widen child capabilities.

## Also accepted: child widget tool list

The removed lifecycle patch changed the child pane widget's `— N tools` count from `getAllTools()` to the active tool set. 3.7.2 still uses `getAllTools()` (`maestro/adapters/pi/child/subagent-done.ts`), so the widget may over-report a child's tools. Cosmetic only; the real allowlist is enforced by `--tools`.

## Consequences

- `tests/pi-herdr-agents-policy-self-check.mjs` asserts the shadowing as intended behavior; a change in upstream precedence fails that check and needs a new decision.
- Children launched without a tool allowlist keep deferred tools and are not gated by `lazy-tools` (upstream-intended).

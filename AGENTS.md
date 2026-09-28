# Agent Instructions

- Never wait on a background job with `until grep …; do sleep` polling loops — one missed pattern hangs the turn until timeout. Wait on the job's completion wake or read it with `jobs action='attach'`. Every loop, if any, carries a counter + `break`; infinite loops without a timeout are forbidden.
- Size timeouts honestly: start short (30–60s) — most commands finish in seconds. Reserve 10-minute timeouts for commands proven to run that long (full nix builds, large suites), not as a default.
- Leave no uncommitted work: end every session with all changes committed and pushed. A dirty tree breaks the local auto-updater and skips deployment.
- Before adding or changing a Nix package, confirm package name, availability, and relevant options with the `nixos` MCP server.
- Before writing or changing a Nix function, confirm its signature and behavior with the `noogle` MCP server.
- If an MCP lookup fails or returns no result, say so; verify against upstream documentation instead of guessing.

## Agent skills

### Issue tracker

Issues use GitHub Issues; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Use canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

# Agent Instructions

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

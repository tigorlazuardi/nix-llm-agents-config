# Handover

## Known context

- Public personal repository, reusable across machines.
- Scope is Home Manager configuration only.
- Upstream [`llm-agents.nix`](https://github.com/numtide/llm-agents.nix) supplies latest packages; confirmed packages: `claude-code` and `pi`.
- Initial agents: Claude Code and Pi.
- Never commit plaintext secrets. Keep machine-local secret hooks and paths.

## Plan before implementation

Start a fresh session to interview and decide:

- Migration scope for current `~/.claude` and `~/.pi/agent`.
- Shared defaults versus per-host overrides.
- Secrets boundaries.
- Supported systems.
- Flake/module public API.
- Checks/tests.
- Pi extensions that runtime-import peer packages.

## Pi NixOS resolution concern

Concrete motivating bug: after old Bun-installed Pi was deleted, npm plugin `@juicesharp/rpiv-ask-user-question` failed resolving `@earendil-works/pi-tui`. Nix Pi internal packages are not automatically visible to `~/.pi/agent/npm` node modules.

Fresh design must solve this durably without reinstalling Bun Pi or assuming Nix store internals resolve as npm peers.

Useful upstream reference: <https://github.com/numtide/llm-agents.nix>.

---
name: pi-mcp-builtin-vs-adapter
description: pi 1.0 built-in MCP vs pi-mcp-adapter plugin coexistence. Use when configuring MCP for pi, adding or debugging pi-mcp-adapter, or seeing "could not turn off Pi's built-in MCP" / EROFS warnings on settings.json.
---

# pi built-in MCP vs pi-mcp-adapter

pi 1.0 ships a native built-in MCP extension (`builtin:mcp`). The lazy
`pi-mcp-adapter` plugin replaces `/mcp` per session, and on startup tries to
disable the builtin by **writing `settings.json`**. On Nix/home-manager setups
that file is a read-only store symlink, so the write fails and every session
shows:

```
Warning: MCP: could not turn off Pi's built-in MCP: ... EROFS: read-only file
system ... settings.json
```

## Fix

Declare the disable yourself in pi settings — in this repo,
`modules/pi-coding-agent.nix` → `defaultSettings.extensions`:

```json
{ "extensions": ["-builtin:mcp"] }
```

- A leading `-` in the `extensions` settings entry disables a built-in
  extension (`builtin:mcp`, `builtin:codemode`, `builtin:tool-search`,
  `builtin:llama.cpp`).
- The adapter checks whether `-builtin:mcp` is already configured **before**
  writing; when present it skips the write, so the EROFS warning disappears.
- Keep the adapter as the MCP owner: it connects servers lazily per session;
  the builtin connects everything at startup.

## Gotchas

- Shell-level `pi mcp add/list/...` commands always use the built-in
  implementation, even when sessions use the adapter.
- Changing this needs a home-manager switch (settings.json is generated, not
  hand-edited) — route through the homelab-flake-update handoff.

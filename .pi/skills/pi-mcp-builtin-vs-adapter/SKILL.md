---
name: pi-mcp-builtin-vs-adapter
description: pi 1.0 built-in MCP vs pi-mcp-adapter plugin coexistence. Use when configuring MCP for pi, adding or debugging pi-mcp-adapter, or seeing "could not turn off Pi's built-in MCP" / EROFS warnings on settings.json.
---

# pi built-in MCP vs pi-mcp-adapter

**Current default (2026-10): adapter OFF, native MCP + codemode.** The adapter
prompts for project-server/tool approval, which blocks subagents; native MCP has
no approval dialog. `plugins.pi-mcp-adapter.enable = false` renders
`programs.mcp.servers` to `~/.pi/agent/mcp.json` (read-only symlink) and sets
`defaultTools = ["+codemode"]`. Setting `enable = true` restores the adapter,
`-builtin:mcp` and `projectServers = "allow"`; the notes below apply then.

Native Pi reads only `.pi/mcp.json`, not a root `.mcp.json`. The local extension
`config/extensions/project-mcp-json` registers `${cwd}/.mcp.json` servers via
`pi.registerMcpServer` (no dialog; gated only by Pi project trust, honouring
`trust.json` and `defaultProjectTrust`). It loads only when the adapter is off,
because the adapter already reads `.mcp.json` itself.
It also expands `${VAR}`, `${VAR:-default}` and inline `!(shell command)` (`sh -c`,
10s timeout) in `command`/`args`/`url`/`cwd`, and `${VAR:-default}` + `!(...)` in
`env`/`headers` (Pi itself expands `$VAR`, `${VAR}`, whole-value `!cmd` there).
Unset variable or failed command skips that server with a warning. It loads
`${cwd}/.env` itself because load order against `env-loader` is not guaranteed.
Per-machine servers go in `${cwd}/.mcp.local.json` (same format; gitignore it). Both
files share the trust gate, `.env` and expansion; a server with the same name in
`.mcp.local.json` replaces the one in `.mcp.json`.

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

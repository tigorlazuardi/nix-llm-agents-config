---
name: pi-extension-nixos
description: NixOS/Nix-packaged Pi extension runtime gotchas. Use whenever building, packaging, installing, or debugging Pi extensions on NixOS or a Nix-installed pi binary, especially extension load failures like Cannot find module for @earendil-works packages or differences from Bun/global installs.
---

# Pi extensions on NixOS / Nix-installed Pi

## Core lesson

A Nix-installed `pi` binary does not behave like the old Bun global install for extension module resolution. A user extension in `~/.pi/agent/extensions/*.ts` should not assume it can runtime-import Pi internals such as `@earendil-works/pi-tui` just because those packages exist somewhere in the Nix store or used to exist under Bun global `node_modules`.

Symptom:

```text
Failed to load extension: Cannot find module '@earendil-works/pi-tui'
Require stack:
- ~/.pi/agent/extensions/<extension>.ts
```

## How to act

1. Check active Pi first:

```bash
which pi
readlink -f "$(which pi)"
pi --version
```

If it points into `/nix/store/...-pi-<version>/bin/pi`, assume Nix-style resolution.

2. For extension code, keep runtime imports minimal:

- OK: type-only imports from Pi core when needed, e.g. `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"`.
- Risky: runtime imports from Pi internal helper packages such as `@earendil-works/pi-tui` from a global/user extension.
- Prefer: local tiny helpers for trivial behavior (`matchesKey`, ANSI-stripped width), or ship dependencies inside the extension package itself.

3. Validate with Pi itself, not only `node require()`:

```bash
PI_OFFLINE=1 pi -p --no-session --no-tools --exclude-tools '*' 'reply ok'
```

A good fix produces normal output and no `[Extension issues]` block.

## Packaging note

For installable Pi extension packages, do not list Pi internal helper packages as peer dependencies unless the extension truly needs consumers to provide them. If the behavior is tiny, inline it. This avoids Nix/Bun/global-node resolution drift.

## Known example

`rate-limit-wakeup.ts` broke after switching from Bun-global Pi to Nix Pi because it runtime-imported `@earendil-works/pi-tui` only for `matchesKey`, `visibleWidth`, and `Component`. The minimal fix was:

- remove runtime `@earendil-works/pi-tui` import;
- keep only Pi core type imports;
- define a local `Component` shape;
- inline `matchesKey` for Escape/Return;
- inline a simple ANSI-strip `visibleWidth`.

This deliberately skips perfect Unicode terminal-width handling. Add real width handling only if overlay alignment visibly breaks for CJK/emoji-heavy text.

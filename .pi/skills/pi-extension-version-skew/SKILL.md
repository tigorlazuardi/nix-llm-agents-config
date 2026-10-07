---
name: pi-extension-version-skew
description: Version-skew rules for in-repo Pi extensions — this repo's nix checks build against a newer nixpkgs snapshot than consumer hosts (homelab, nspawn boxes), same pi version string. Use when authoring or reviewing config/extensions/*, adding an @earendil-works import, writing or tightening an extension's nix check, debugging an extension that passed checks but crashes on a consumer host ("X is not a constructor" / "not a function"), or arming herdr-web-ui digit cards for pi panes.
---

# Pi extensions across consumer nixpkgs snapshots

**Version skew**: this repo builds its checks against one nixpkgs snapshot;
homelab (and each nspawn box) builds pi against another — same `pi 1.0.0`
string, different bundled `@earendil-works/pi-tui`. Three failures came from
exactly this gap; each check that would have caught it costs one line.

## 1. Import only what a proven-old artifact exports

`DynamicBorder` exists in our check snapshot, not in homelab's (f45c6f0):
import resolved to `undefined`, `new undefined` → `DynamicBorder is not a
constructor` in every real session while our check stayed green.

Before adding an `@earendil-works/*` import to an in-repo extension, confirm
the symbol lives in a **proven-old artifact** — the pinned `pi-ask-herdr`
store path uses only `Input, matchesKey, TUI, truncateToWidth,
visibleWidth, wrapTextWithAnsi` from pi-tui, and the theme color keys
`accent/dim/muted/warning` (`border` as a key is newer too). When a new
symbol is unavoidable, feature-detect at import time and keep a fallback
path. Keep pure logic in files with zero `@earendil-works` imports — that is
what lets the self-check run outside pi at all (`screen.ts` pattern).

## 2. The load probe does not initialize extensions — grep contracts

`pi -e <ext> --list-models` exits 0 with a deliberately broken extension
(verified: named-only export, zero error output). It catches syntax and
module failures, nothing else. Anything loadable-but-wrong needs an explicit
grep in the check:

- default export — pi's loader imports with `{ default: true }` and requires
  a function; named-only = "Extension does not export a valid factory
  function" in every real session,
- tool name / schema markers, anything else the extension must contain.

## 3. herdr-web-ui digit card needs the hint as the LAST shown line

`fallbackMenu` (server/prompt.ts) arms the digit-button card only when the
chooser hint is the screen's last *shown* line. Blank and divider lines drop
out — a pure `─` border is `DIVIDER_RE` and vanishes, so framing is safe.
Two things break it inside pi:

- pi's status footer renders below the editor area → swap a zero-height
  footer in for the wizard (`ctx.ui.setFooter(factory)`, restore with
  `undefined` in finally, optional-called — the API lives in
  pi-coding-agent's own extension types, not pi-tui, so it survives skew).
- menus need ≥ 2 numbered rows: a single-row text question renders a second
  row (Type + Skip pattern).

Regex ports of the parser live in
`config/extensions/ask-user/ask-user.self-check.ts` — extend those fixtures
when herdr-web-ui's parser changes, instead of re-deriving the contract.

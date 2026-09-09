# Terminal-browser → Pi / Herdr handoff contract

**Scope.** Planning research for issue 16 only. Findings pin terminal-browser to
v0.8.1, commit `b16b8574a026ba0ef451e7e377e12b5747c47706`; release extraction
is `/tmp/terminal-browser-release.srL9rW/terminal-browser` (`VERSION` = `v0.8.1`,
`CHANNEL` = `stable`). Source checkout: `/tmp/terminal-browser`. “Verified” below
means present in that source/release or an owning first-party Herdr source; it does
**not** mean exercised against an interactive Pi currently running a tool.

## Executive contract

- **Verified:** `terminal-browser action` selects one registered browser and one
  internal tab, connects its published CDP port through its bundled `agent-browser`,
  and runs the requested agent-browser command against the matched Chrome target.
  It also marks the selected browser tab *agent-controlled* before the action.
- **Verified:** Ctrl+G is a distinct UI path. It injects/activates `react-grab` in
  the active Electron `webContents`; its selected content is copied first, then
  sent as text to a best-effort pane target and that pane is focused.
- **Important distinction:** action ownership (`agent-touch` / 10-second TTL /
  `action done`) and Ctrl+G handoff are independent. Ctrl+G neither sets an action
  ownership marker nor releases one.
- **Unknown / not guaranteed:** no code waits for Herdr/Pi state, proves the
  destination is Pi, checks whether Pi is rendering a turn or tool, or confirms
  that Pi accepted the injected bytes as a user message. “Sent to agent” means only
  the terminal adapter call resolved.

## 1. CLI/action → visible tab

### Instance and tab selection — verified

The CLI calls `browsers(terminal)`, which combines persistent instance records with
each instance control socket's `where` response. With no `--browser`, `action`
requires exactly one browser in the caller's terminal tab; `--browser`, `--tab`, or
`--target` narrow selection. Ambiguity, missing browser/tab/target, no CDP port, or
no CDP target throws a descriptive error rather than guessing.

- Local: [`cli/src/instances.ts`](/tmp/terminal-browser/cli/src/instances.ts),
  [`cli/src/action.ts`](/tmp/terminal-browser/cli/src/action.ts).
- Upstream: [`instances.ts`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/cli/src/instances.ts),
  [`action.ts`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/cli/src/action.ts).

A browser session registers its terminal name, tab, pane, socket, CDP port and tab
metadata. `where` obtains the browser's own pane through the adapter; `targets`
includes internal tab id, URL, active bit, CDP target id, `performance.timeOrigin`,
and `agentControlled`.

- Local: [`browser/src/registry.ts`](/tmp/terminal-browser/browser/src/registry.ts),
  [`browser/src/session/session.tsx`](/tmp/terminal-browser/browser/src/session/session.tsx),
  [`browser/src/session/tabs.ts`](/tmp/terminal-browser/browser/src/session/tabs.ts).
- Upstream: [`registry.ts`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/registry.ts),
  [`session.tsx`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/session/session.tsx),
  [`tabs.ts`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/session/tabs.ts).

### CDP / agent-browser bridge — verified

The Electron main process allocates a loopback remote-debugging port and passes it
to the session registry. `action` launches shipped `agent-browser` with a session
name derived from the browser record. It first tries `tab list --json`; if that
fails, it runs `connect <port> --json` and retries. It maps terminal-browser's tab
to agent-browser's tab by exact URL; when ambiguous, it probes each target's
`performance.timeOrigin`. It switches agent-browser to that target, optionally
makes the visible tab active (`--follow`), then invokes the requested subcommand.

This is target selection, not a permission boundary: `agent-browser` is explicitly
allowed to drive the visible browser; launch/connect/profile flags are blocked so
it cannot choose a different engine or CDP endpoint.

- Local/upstream: [`cli/src/action.ts`](/tmp/terminal-browser/cli/src/action.ts)
  / [permalink](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/cli/src/action.ts),
  [`browser/src/main.tsx`](/tmp/terminal-browser/browser/src/main.tsx)
  / [permalink](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/main.tsx).

### Action ownership/release — verified

Before any non-`done` action, the CLI sends `agent-touch` for the chosen internal
tab and ignores only a control-socket failure. The tab manager exposes this as
`agentControlled`, expires it after 10 seconds by default
(`TERMINAL_BROWSER_AGENT_CONTROL_MS` can override), and `action done` sends
`agent-release` for **all** tabs in that browser session. Failures after the touch
can therefore leave the marker until TTL or `done`.

- Local/upstream: [`cli/src/action.ts`](/tmp/terminal-browser/cli/src/action.ts)
  / [permalink](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/cli/src/action.ts),
  [`browser/src/session/tabs.ts`](/tmp/terminal-browser/browser/src/session/tabs.ts)
  / [permalink](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/session/tabs.ts).

## 2. Ctrl+G → DOM/React/source context → pane

### Capture path — verified

Ctrl+G is accepted only for press events with Ctrl+G and no Super/Alt/Shift (unless
shortcuts are disabled). It toggles a per-controller `Grab`. On activation the
controller attaches Electron's CDP debugger, loads the bundled `react-grab` global
library if necessary, registers the `terminal-browser` react-grab plugin, and
activates it. The plugin's copy transform emits selected `content` through the CDP
`Runtime.addBinding` binding named `__pixelEmit`; the host receives it, resets and
deactivates react-grab, and calls `sendGrab(content)`.

`content` is react-grab's output. Terminal-browser does not independently parse or
validate a DOM/React/source schema; exact fields and source coverage belong to the
bundled react-grab library. This is therefore **verified transport, unknown content
shape/provenance** without a capture fixture.

- Local: [`keybindings.ts`](/tmp/terminal-browser/browser/src/session/keybindings.ts),
  [`grab.ts`](/tmp/terminal-browser/browser/src/grab/grab.ts),
  [`controller.ts`](/tmp/terminal-browser/browser/src/page/controller.ts),
  release asset [`assets/react-grab/index.global.js`](/tmp/terminal-browser-release.srL9rW/terminal-browser/assets/react-grab/index.global.js).
- Upstream: [`keybindings.ts`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/session/keybindings.ts),
  [`grab.ts`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/grab/grab.ts),
  [`controller.ts`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/page/controller.ts).

### Target discovery and Pi detection — verified

`AgentPaneFinder.warm()` starts discovery while selection UI is active. Discovery:

1. lists adapter panes and fills absent `command` fields via `ps -e -o tty=,args=`;
2. identifies the browser's own pane and confines candidates to that tab;
3. prefers the supplied `--parent-tty` pane, even if it is not recognised as an
   agent;
4. otherwise chooses the first neighbour recognised by `codingAgent(command)`;
5. otherwise chooses the first neighbour; no self/no neighbour returns `null`.

For Herdr, the adapter lists Herdr panes then `pane process-info` foreground
commands. Its `codingAgent` matcher is command-line based. Thus a target marked
`agent: true` reflects a recognised foreground command; it is not a protocol-level
Pi identity or readiness assertion. Parent and fallback-neighbour targets can be
non-agent shells.

- Local/upstream: [`grab/target.ts`](/tmp/terminal-browser/browser/src/grab/target.ts)
  / [permalink](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/grab/target.ts),
  [`terminals/herdr.ts`](/tmp/terminal-browser/terminals/src/terminals/herdr.ts)
  / [permalink](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/terminals/src/terminals/herdr.ts),
  [`agents.ts`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/terminals/src/agents.ts).

### Send, format, focus, fallback, and errors — verified

`sendGrab` first writes raw `content` to the terminal-browser root clipboard. It
then asks the finder to send it. For a recognised agent, the bytes are:

```text
> <content with C0/C1 controls replaced; all whitespace collapsed>


```

For any other target they are shell-quoted as one literal shell argument instead.
The finder calls adapter `sendText`; on failure it drops cached target data,
rediscovers once, and retries once. On successful send it attempts focus but
suppresses focus errors. No terminal/send capability, no discovered target, or a
re-discovery yielding none returns `null`; UI says `copied to clipboard`. An
unrecovered send error produces an error toast. Toasts can be suppressed by
`--no-overlays` or app-tab mode.

Under Herdr, `sendText` calls `herdr pane send-text <pane> <bracketedPaste(text)>`.
It focuses cross-tab targets by focusing their tab, then calls socket method
`pane.focus`. Herdr's owning protocol defines `pane.send_text` as `{pane_id,text}`
and writes the supplied text bytes to that pane runtime.

- Terminal-browser local/upstream: [`target.ts`](/tmp/terminal-browser/browser/src/grab/target.ts)
  / [permalink](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/grab/target.ts),
  [`session.tsx`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/session/session.tsx),
  [`herdr.ts`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/terminals/src/terminals/herdr.ts).
- Herdr source inspected locally: `/tmp/herdr/src/api/schema/panes.rs` and
  `/tmp/herdr/src/app/api/panes.rs`; upstream
  [`PaneSendTextParams`](https://github.com/herdrdev/herdr/blob/b9ce96869e89937278d673d70ae4c135dd318469/src/api/schema/panes.rs) and
  [`handle_pane_send_text`](https://github.com/herdrdev/herdr/blob/b9ce96869e89937278d673d70ae4c135dd318469/src/app/api/panes.rs).

## 3. Pi-turn / tool-active boundary

**Verified facts.** Herdr has distinct lifecycle reporting (`report-agent`) and
recognises Pi as an agent kind; its documented states include working, blocked,
idle/done, and unknown. Its source exposes lifecycle reporting separately from
`pane.send_text`. Terminal-browser's Ctrl+G adapter does not call Herdr agent
status/read/wait APIs, and does not use Pi's extension API.

- Herdr source: [`report-agent CLI`](https://github.com/herdrdev/herdr/blob/b9ce96869e89937278d673d70ae4c135dd318469/src/cli/spec.rs),
  [`agent automation docs`](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.0/docs/next/website/src/content/docs/agent-automation.mdx),
  local `/tmp/herdr/src/cli/spec.rs`.
- Project pins pi-herdr 0.4.0 and describes its agent tool as targeting a recognised
  coding agent: [`pi-plugins.json`](../../pi-plugins.json), packaged primary source
  `/tmp/pi-herdr-npm/package/index.ts`.

**Unknowns requiring a prototype.** While Pi is streaming, waiting for a tool,
showing a confirmation, or has bracketed paste mode negotiated, we have not
observed whether the injected paste becomes queued composer text, an immediate
submission, a literal terminal artifact, or is rejected. We also have not observed
whether Herdr's command snapshot calls Pi when its UI is in an alternate screen.
Neither terminal-browser nor Herdr send-text supplies an acknowledgement from Pi.

## 4. Stable seam for an explicit untrusted-browser-context marker

### Recommended minimal seam (inference)

Add a **structured, user-selected marker at the `sendGrab` / `AgentPaneFinder.send`
boundary**, not to CDP, react-grab, Herdr pane bytes, or command detection. Preserve
raw captured content in clipboard. Send a short, stable envelope whose first line
identifies it as untrusted browser context and whose body carries the existing
sanitised capture; make the user select/confirm the target pane before delivery.

Why this seam:

- it is downstream of react-grab capture, so DOM/React/source fidelity survives;
- it centralises target identity, formatting, retry, and focus;
- it applies only to explicit Ctrl+G, not autonomous `action` control;
- it does not overload `agentControlled`, which tracks browser ownership and is
  TTL-based rather than a source-trust statement.

Keep a machine-readable field inside terminal-browser only if a receiving Pi
extension will consume it. Herdr `pane.send_text` transports bytes, not metadata;
adding a pseudo-protocol there risks leakage into non-Pi fallback shells. The safe
first prototype is an obvious textual envelope plus target confirmation, retaining
clipboard fallback.

### Ownership and release implications — inference

Do not call `agent-touch` for Ctrl+G merely to carry trust state: it would claim
browser control the user did not grant and `action done` releases every marked tab.
A user-selected context should be a one-message provenance label. If later work
adds persistent state, scope it to `{browser instance, tab id, capture nonce}` and
clear it after successful send, explicit cancel, tab close, and send failure; never
reuse a 10-second ownership TTL as proof of user intent.

Release/build ownership is split: source/behavior belongs upstream
terminal-browser; this repository packages the immutable v0.8.1 tarball and only
patches setup/upgrade/AppArmor behavior in [`packages/terminal-browser.nix`](../../packages/terminal-browser.nix).
A local change to upstream behavior requires a new pinned release hash and review;
a Pi-side consumer is separately owned/versioned via the Pi plugin registry.

## 5. Prototype questions / acceptance observations

1. With Herdr and Pi in sibling panes, capture a DOM element with React/source
   metadata. Record exact clipboard text, sent bytes (`herdr pane read`), and Pi UI
   result in idle, streaming/tool-active, and confirmation states.
2. Repeat with parent pane non-Pi, Pi sibling, multiple Pi neighbours, and Pi in a
   different tab. Confirm target precedence and focus side effect.
3. Force `pane.send-text` failure after clipboard write. Verify retry target,
   clipboard preservation, toast, and that no ownership marker changes.
4. Compare an explicit text envelope with a Pi extension-recognised envelope.
   Decide whether user confirmation selects a pane ID, a discovered Pi identity, or
   both; reject stale selections.
5. Confirm whether Pi treats bracketed-paste text ending in two newlines as queued
   input or a submitted message in each state. This determines whether a safer
   non-submitting handoff protocol is needed.

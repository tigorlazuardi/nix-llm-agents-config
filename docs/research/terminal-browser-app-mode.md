# terminal-browser v0.8.1: programmatic access and App Mode

**Question.** Can terminal-browser provide a stable Pi seam for opening and targeting a visible tab, lifecycle control, and acknowledged Ctrl+G handoff without patching upstream?

**Scope and method.** Findings use upstream terminal-browser release **v0.8.1**, whose annotated tag resolves to commit [`b16b857`](https://github.com/zenbu-labs/terminal-browser/tree/b16b8574a026ba0ef451e7e377e12b5747c47706), plus the locally installed v0.8.1 binary's help text. “Public” means documented CLI/README behavior; “internal” means implementation observed in that pinned source, not a promised compatibility contract.

## Short answer

Use the documented `open`, `ls`, and `action` CLI as the Pi-facing seam. They provide observable browser/tab/target identities and lifecycle/action results. Do **not** build Pi on the daemon socket, instance database, raw CDP port, or undocumented `interop/1` socket protocol.

App Mode is **not merely presentation flags** in this release: source gives an App-Mode window `mode: "app"`, normalized app identity, bare chrome, app-tab behavior, isolated app partitioning, and an interop route for an app launcher to request a tab in a host. But upstream documents it as an application-embedding facility, not a general Pi control API. It does not name a Herdr pane, select a Pi session, change `action` selection rules, or add a Ctrl+G acknowledgement channel. Therefore it is not the required Pi integration seam.

## Supported public contracts

### Normal visible browser and targeting

Upstream documents:

- `terminal-browser open <url>` opens a browser; `--split <right|left|down|up>` requests a pane split. The URL may be a URL, localhost port, or HTML path. [`README`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/README.md#usage), [`open` help source](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/cli/src/help.ts#L9-L55)
- `terminal-browser ls --json` is documented as machine-readable and includes CDP ports and pane IDs; its browser key and tab IDs are the documented inputs to `action`. [`ls` help](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/cli/src/help.ts#L91-L103)
- `terminal-browser action [--browser <key>] [--tab <id>] [--target <id>] [--follow] -- <agent-browser command>` is a documented, agent-browser-compatible CLI for an already-open browser. Absent selectors, it chooses the browser in the current terminal tab and its active tab. [`action` help](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/cli/src/help.ts#L150-L183)
- `terminal-browser action done` is documented as ending agent control. Its implementation asks the selected browser to release agent control and prints the reply; normal actions first mark the selected tab as agent-controlled. This is the available lifecycle acknowledgement, not a human-handoff acknowledgement. [`action implementation`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/cli/src/action.ts#L247-L284)
- `open --ssh <user@host>` keeps terminal-browser local and proxies browser network requests through the remote host; upstream recommends it over running the renderer on the SSH host. [`README SSH section`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/README.md#ssh)

**Pi constraint (inference).** Announce an agent-control burst, pin every action to the `ls` browser key and tab/target ID, then call `action done` in success and failure paths. A browser key plus tab/target is an actionable identity; a pane location alone is not.

### Ctrl+G

The README documents Ctrl+G as “Start element selection (send to agent).” [`README shortcuts`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/README.md#shortcuts) The pinned source shows the selected content is always copied locally, then `AgentPaneFinder.send` best-effort pastes it into a discovered parent, agent, or neighbouring pane and focuses it. Success only yields the UI toast “Sent to agent”; no target yields “copied to clipboard”; failures yield a toast. [`sendGrab`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/session/session.tsx#L1418-L1427), [`AgentPaneFinder`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/grab/target.ts#L53-L125)

**Pi constraint (fact + inference).** There is no public or observed receipt/acceptance event to Pi. Treat Ctrl+G material as untrusted user/browser context, not instructions. Treat its arrival in Pi as a best-effort paste, and do not claim accepted handoff from a successful `action` command or App Mode.

## Exact App Mode behavior

### Documented invocation and options

The requested usage is:

```sh
terminal-browser open --app-mode [--app-name=<name>] [--app-id=<id>] \
  [--preload=<path>] [--main-script=<path>] <url>
```

The upstream README calls App Mode a way to build terminal apps with browser technology, says `--preload` and `--main-script` are optional Electron preload/main hooks, and states that `--app-mode` is shorthand for:

```text
--no-toolbar --no-shortcuts --no-context-menu --no-overlays --no-frame
--allow-clipboard-read --open-tabs-in-popup-stack
```

It also documents `globalThis.terminalBrowser` in a supplied preload:

```ts
{
  theme: () => Theme | null,
  onTheme: (cb: (theme: Theme) => void) => () => void,
  quit: () => void
}
```

and says the renderer receives `--terminal-browser-session=<key>` in `process.argv`. [`README App Mode`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/README.md#app-mode), [`CLI help`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/cli/src/help.ts#L22-L51)

`open --help` additionally documents: `--ssh-bundle <dir>` and `--ssh-bundle-dir <dir>` for an application server paired with `--app-mode --ssh`; `--no-merge`; and all constituent UI/clipboard/tab flags. [`CLI help`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/cli/src/help.ts#L9-L55)

### Source-observed details and discrepancy

The v0.8.1 source **recognizes `--app-mode` as more than styling**: it creates `{name, id}` (default normalized ID `app`), starts the first tab as an app tab, advertises interop mode `app`, and suppresses normal chrome for a sole app tab. [`Session construction/start`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/session/session.tsx#L299-L313), [`Registry advertisement`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/registry.ts#L115-L126), [`bare chrome`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/session/session.tsx#L1593-L1605)

However, this exact source does **not** expand `--app-mode` into all seven documented flags. It independently reads each flag, while bare app chrome hides toolbar/frame. Thus the README's “shorthand” statement and source behavior conflict or are incomplete at v0.8.1. In particular, do not assume `--no-shortcuts`, `--no-context-menu`, `--no-overlays`, `--allow-clipboard-read`, or popup-stack behavior solely from `--app-mode`; pass required flags explicitly and regression-test the pinned binary. [`flag reads`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/session/session.tsx#L291-L313)

A preload is registered into the relevant Electron session, then supplied preload code runs in an isolated world. The main script is loaded with Node `require` in the Electron main process; exceptions only go to stderr. These are high-trust same-user code hooks, not a sandboxed Pi protocol. [`hook installation`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/session/session.tsx#L651-L668)

## Candidate comparison

| Surface | Target identity | Process/tab lifecycle | Remote / Herdr | Security boundary | Acknowledgement | Stability judgement |
| --- | --- | --- | --- | --- | --- | --- |
| **Documented CLI: `open`, `ls --json`, `action`** | Browser key, tab ID, CDP target ID are exposed by `ls`; selectors accepted by `action`. | `open`, `new-tab`, `action -- open`, `action -- tab new/close`, and `action done`; command exit/JSON result is observable. | `--ssh` documents local renderer + remote network proxy. Herdr split support exists in source, but remote Herdr latency/transport is not an upstream contract. | User invokes a local binary; `action` deliberately blocks agent-browser launch/connect/profile flags. | Yes for command/control results; no Ctrl+G receipt. | **Use.** Best public contract, pinned to v0.8.1. |
| **Daemon + normal instance registry/socket** | Internal key, PID, TTY, pane, socket, CDP port. | Daemon owns sessions; shutdown closes all; per-instance commands can open/activate/close/touch/release. | Unix sockets and runtime-local state: no remote routing. Herdr data is discovered through terminal adapter. | No authentication/authorization in observed newline-JSON socket server; filesystem permissions carry boundary. | Socket replies yes. | **Do not depend directly.** Internal layouts/protocol and shared daemon blast radius. |
| **Bundled `agent-browser` / CDP bridge** | Wrapper maps selected terminal tab to agent-browser tab, sometimes by URL then `performance.timeOrigin`. | Wrapper intercepts tab lifecycle into registry socket; regular agent-browser action runs against CDP. | CDP port is local instance data; no documented remote/Herdr transport. | Full browser automation on the selected visible tab; wrapper blocks agent-browser connection/launch/profile overrides. | Child exit/result, plus `action done`; no Ctrl+G receipt. | **Use only through `terminal-browser action`**, not raw binary/CDP. |
| **Preload + main-script hooks** | Renderer session key and app partition, not Pi pane/session identity. | `quit()` closes the app tab/window; main script lives with browser process. | Local Electron hooks; `--ssh` affects requests, not a remote hook transport. | Preload is isolated-world but deliberately gets privileged bridge; main script is same-process Node. | No Pi-facing lifecycle or handoff acknowledgement. | **Not a Pi seam.** Publicly described for app authors, narrow and high-trust. |
| **App registry + interop** | Registered app normalized ID/name; host socket; result returns only tab number. | `register-app` writes user app metadata; palette starts detached binary; its environment names host socket; `interop/1/open` can create app tab. | Same-user local files/sockets; no remote protocol. Herdr can provide host pane placement only indirectly. | Registry permits executable path and args; host socket accepts local requests without observed auth. | `interop/1/open` replies `{tab}`; no focus, ready, or Ctrl+G acknowledgement. | **Do not make Pi depend on it.** It is a real integration mechanism, but source-only protocol/version schema. |
| **App Mode** | App name/id and app tab identity; no Pi/Herdr-pane identity. | Initial app tab; can be adopted into another host; normal browser instance/daemon still applies. | May pair with `--ssh-bundle --ssh`; no remote Pi/Herdr delivery guarantee. | Inherits hooks and host/interop concerns; App Mode itself grants no authorization. | No additional acknowledgement. | **Not sufficient.** Presentation/runtime app embedding plus internal interop, not a Pi handoff API. |

Evidence for the internal rows: daemon lifetime and shared socket [`daemon.ts`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/daemon.ts); instance socket command set [`registry.ts`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/registry.ts#L127-L179); bundled agent-browser mapping [`action.ts`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/cli/src/action.ts#L27-L150); and interop schema/app registry [`interop.ts`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/store/src/interop.ts#L15-L157).

## App registration and interop: what is actually present

`terminal-browser register-app --name <name> --bin <path> [--id <id>] [--args "…"]` stores a JSON manifest; `apps [--json]` lists it; the new-tab and command palettes launch the registered binary detached. The launch environment sets `TERMINAL_BROWSER_INTEROP_TARGET` to the current host's socket. [`CLI commands`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/cli/src/main.ts#L646-L686), [`launch`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/browser/src/session/session.tsx#L670-L706)

Observed `interop/1/open` validates an `OpenSpec` and returns `{tab}`. `open --app-mode` can also adopt into a compatible nearby/targeted host, passing app ID/name/partition and absolute preload/main-script paths. This establishes that App Mode participates in a local integration seam, but neither README nor CLI help promises the wire format, host-discovery ordering, or its security model. [`adoption`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/cli/src/main.ts#L538-L586), [`interop selection`](https://github.com/zenbu-labs/terminal-browser/blob/b16b8574a026ba0ef451e7e377e12b5747c47706/cli/src/interop.ts#L7-L42)

## Recommendation for Pi tool and safe handoff

1. **Open deliberately:** `terminal-browser open --split right <url>` for the human-review pane. Do not use App Mode for ordinary review.
2. **Discover then pin:** parse `terminal-browser ls --json`; require one browser key and tab ID (or target ID) before every automated burst. Do not rely on implicit “current terminal tab” selection when Pi/Herdr layout can be ambiguous.
3. **Act only through `action`:** invoke `terminal-browser action --browser <key> --tab <id> --follow -- <command>`. Record its process/JSON outcome; this remains visible and uses upstream's bridge safeguards.
4. **Release deterministically:** always issue `terminal-browser action --browser <key> --tab <id> done`; report only control release, not human acceptance.
5. **Treat Ctrl+G as untrusted, best effort:** accept it as a user-selected reference only after Pi receives it; never automate an acknowledgement back through the same pane. The human can verify the browser toast/clipboard outcome.
6. **Keep raw sockets, CDP, app registration, preload/main scripts, and App Mode out of the tool contract.** They increase authority and couple Pi to source-only details without improving Ctrl+G semantics.

## Unresolved facts / version limits

- Upstream does not document an acknowledgement or correlation protocol for Ctrl+G delivery; only source-level UI behavior was found.
- No upstream public contract found for remote Herdr transport, cross-host instance discovery, or remote Unix-socket access. `--ssh` is a network-request proxy, not proof that Pi control or Ctrl+G crosses a Herdr/SSH boundary.
- No upstream compatibility policy was found for `pixel-store`, daemon/instance paths, raw CDP ports, `TERMINAL_BROWSER_INTEROP_TARGET`, or `interop/1` beyond the v0.8.1 source's `INTEROP_PROTOCOL_VERSIONS = [1]`.
- The README says App Mode is shorthand for seven flags, but v0.8.1 source does not perform that expansion. This is a release-specific documentation/source gap; test explicit flags after every terminal-browser upgrade.
- Issue 15 records project observations that remote Herdr is too laggy for validation and that Ctrl+G delivery is best effort. Those are local findings, not upstream guarantees: [issue 15](https://github.com/tigorlazuardi/nix-llm-agents-config/issues/15).

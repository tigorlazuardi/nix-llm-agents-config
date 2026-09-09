# Native Pi `terminal_browser` tool seam

**Issue:** #17 — planning only.
**Baseline inspected:** `38b52dd` (`feat(pi): add optional terminal browser companion`).
**Active runtime evidence:** `pi --version` reports 0.85.1; Pi API claims below are
verified against its installed primary docs and declarations, not the earlier 0.80.10
store path cited by the first revision.
**Scope:** smallest safe design for one deferred native Pi tool. This report does not
change the existing terminal-browser handoff research.

## Decision in brief

**Recommendation (inference).** Add one project-local extension that registers a
single tool named `terminal_browser`; add its source path to lazy-tools' `browser`
group; install that extension only when
`programs.pi-coding-agent.terminalBrowser.enable` is true. Keep the upstream
`terminal-browser` executable in `home.packages` under that same option. Do not
route visible human co-browsing through browser-goblin.

The tool is deliberately an action dispatcher, rather than a general shell tool:
`open`, `snapshot`, `click`, `fill`, `eval`, `ls`, and `done`. It invokes a fixed
Nix-resolved executable with a fixed argv mapping. `browser-goblin` remains the
route for autonomous testing, debugging, visual QA, and unattended browser work.

## Verified facts

### Pi extension API and tool contract

- Pi extensions are TypeScript-loaded factories receiving `ExtensionAPI`; tools are
  registered with `pi.registerTool()`. `typebox` is an official available import,
  and Pi documentation specifically requires `StringEnum` from `@earendil-works/pi-ai`
  for string enums because `Type.Union`/`Type.Literal` does not work with Google's
  API. [Pi extensions — Quick Start and imports][pi-ext-quick], [tool definition][pi-ext-tool],
  [installed `ToolDefinition` declaration][pi-ext-api].
- A tool `execute` receives `(toolCallId, params, signal, onUpdate, ctx)`. Pi's
  documented `pi.exec(command, args, { signal })` takes an executable and argv
  separately; its installed declaration reports `stdout`, `stderr`, numeric `code`,
  and `killed`. This supports execution without constructing a shell command.
  [Pi tool definition][pi-ext-tool]; [installed `ExecResult` declaration][pi-exec-api].
- Tool failures must be signalled by throwing; a returned result is not marked an
  error. Pi says tools **must** bound output; its default helpers use 50 KB or 2,000
  lines, whichever is first, and require informing the model when truncated.
  [Pi custom-tools error and truncation guidance][pi-ext-output].
- `signal` is the current tool/turn cancellation signal. Pi documents it for
  abort-aware nested process work. [Pi extension context][pi-ext-context].
- Native Pi has a real active-tool boundary: registered tools can be hidden or
  enabled with `getAllTools`, `getActiveTools`, and `setActiveTools`; tools registered
  after startup are immediately visible to these APIs. In 0.85.1, a purely additive
  active-set change is recorded on the loader result and exposed before the next
  model request; native-capable Anthropic/OpenAI models preserve a deferred-loading
  protocol, while other models receive the normal active-tool list. [Pi API][pi-ext-active],
  [Pi dynamic tool loading][pi-ext-dynamic].
- A skill is progressive disclosure, not a native tool: startup sees its name and
  description and the model loads `SKILL.md` when needed. [Pi skills][pi-skills].
  Therefore the existing skill is correct guidance for humans/model routing, but it
  cannot provide a typed tool, cancellation, or structured execution result.

### Existing repository seam

- `config/extensions/lazy-tools/index.ts` selects tools by the source path marker
  `browser-goblin` for group `browser`, removes all group matches at `session_start`,
  and exposes eager `load_tools`. Its self-check models source paths and asserts that
  each group is absent initially and becomes active after `load_tools`.
  [`index.ts`](../../config/extensions/lazy-tools/index.ts),
  [`lazy-tools.self-check.ts`](../../config/extensions/lazy-tools/lazy-tools.self-check.ts).
- `.pi/rules/pi-plugin-lazy-tools.md` requires every newly deferred tool group to be
  inspected and self-checked. No new group is needed: the new tool belongs to the
  existing visible-browser `browser` group. [Repository rule](../../.pi/rules/pi-plugin-lazy-tools.md).
- `modules/pi-coding-agent.nix` currently creates
  `terminalBrowserPackage` with `pinnedPkgs.callPackage ../packages/terminal-browser.nix { }`,
  conditionally adds that derivation to `home.packages`, conditionally exposes the
  `terminal-browser` skill, and enables Herdr kitty graphics only when Pi, terminal
  browser, and Herdr are enabled. It always manages the lazy-tools extension under
  Pi's config directory. [Module package/options/wiring](../../modules/pi-coding-agent.nix).
- The baseline package is a repository derivation, not a `nixpkgs` attribute. It
  provides `$out/bin/terminal-browser`, declares `meta.mainProgram =
  "terminal-browser"`, and is limited to `x86_64-linux`. Its pinned upstream release
  is v0.8.1 / `b16b8574a026ba0ef451e7e377e12b5747c47706`.
  [`packages/terminal-browser.nix`](../../packages/terminal-browser.nix).
- `checks.nix` already evaluates enabled/disabled module outcomes, verifies the
  conditional package/skill/kitty-graphics output, load-tests lazy-tools in an
  isolated offline Pi runtime, and smoke-tests the packaged executable without
  creating runtime state. [`checks.nix`](../../checks.nix).
- Browser-goblin is a separate packaged Pi plugin. Its wrapper fixes its
  `agent-browser` executable and the module puts it in `settings.packages` only
  when its plugin option is enabled. [`packages/browser-goblin.nix`](../../packages/browser-goblin.nix),
  [`modules/pi-coding-agent.nix`](../../modules/pi-coding-agent.nix),
  [`pi-plugins.json`](../../pi-plugins.json).
- Existing user-facing routing is explicit: terminal-browser is for a visible,
  human-in-the-loop tab and Ctrl+G DOM/React/source handoff; browser-goblin is for
  autonomous browser testing and QA. [`config/skills/terminal-browser/SKILL.md`](../../config/skills/terminal-browser/SKILL.md).

### Nix lookup record

**Fact:** NixOS and Noogle MCP tools were not available in this research session;
no MCP query could be issued. This report therefore does not guess at a new Nix
package or function.

**Verified upstream substitute:** `callPackage` is the Nixpkgs function used to
call a function/path with an attribute set; the Nixpkgs source defines
`callPackage = callPackageWith pkgs`. [Nixpkgs `customisation.nix`][nix-callpackage].
The repository's existing exact call and the checked module evaluation establish
this plan's only Nix assumption: reuse the existing `terminalBrowserPackage`, not
a new package/function. [Module](../../modules/pi-coding-agent.nix),
[checks](../../checks.nix). Before implementation changes Nix expressions, repeat
the required MCP lookup; if still unavailable, verify the exact function and Home
Manager option against its owning upstream documentation.

## Recommended smallest contract (inference)

### Registration and lazy loading

1. Add one extension directory, e.g.
   `config/extensions/terminal-browser-tool/index.ts`, exporting one Pi extension.
   Register exactly `terminal_browser`; do not add a plugin-lock registry entry:
   this is a repository-owned local extension, while `pi-plugins.json` is only the
   third-party lock/update registry by rule. [Lock rule](../../.pi/rules/pi-plugin-lock.md).
2. In `lazy-tools`, extend the existing `browser` marker list with a stable,
   specific substring such as `terminal-browser-tool`. Do not match the bare
   `terminal-browser` binary path: lazy-tools classifies registered Pi-tool
   `sourceInfo.path`, so the extension-source marker is the stable boundary.
3. Add `terminal_browser` and its representative source path to the `browser`
   fixture in `lazy-tools.self-check.ts`. Assert it is absent after `session_start`
   and present only after `load_tools({ group: "browser" })`.
4. Link/install the extension only under
   `cfg.enable && terminalBrowser.enable`; retain the existing conditional
   `home.packages` binary and skill. This avoids a loadable tool whose executable
   is unavailable, while preserving a Nix-managed binary for manual skill use.

### Tool schema and argv mapping

Use a strict TypeBox object with an enum action plus action-specific optional
fields. `StringEnum` is required for `action`.

| Action | Required fields | Exact argv after fixed executable |
| --- | --- | --- |
| `open` | `url` | `open --split right <url>` |
| `snapshot` | none | `action -- snapshot` |
| `click` | `target` | `action -- click <target>` |
| `fill` | `target`, `text` | `action -- fill <target> <text>` |
| `eval` | `script` | `action -- eval <script>` |
| `ls` | none | `ls` |
| `done` | none | `action done` |

Validate the selected action's fields before executing and reject irrelevant or
missing fields rather than passing arbitrary trailing arguments. `url` is an argv
value, not shell source. `eval` remains intentionally powerful but only within the
user-visible terminal-browser tab; description/guidelines must reserve it for the
visible shared tab after announcing control.

**Executable resolution:** inject the absolute store path at Nix evaluation time
(or a tiny wrapper containing it) and call `pi.exec(resolvedTerminalBrowser, argv,
{ signal })`. Do **not** depend on ambient `PATH`, use `sh -c`, concatenate a
command string, or look up `terminal-browser` dynamically. The package's declared
main program validates the target binary name but does not itself make ambient PATH
a safe dependency. [`packages/terminal-browser.nix`](../../packages/terminal-browser.nix).

### Cancellation, result, and bounds

- Pass Pi's supplied `AbortSignal` to `pi.exec`; if already aborted, return a
  clear cancelled result without spawning. Treat `result.killed` or a now-aborted
  signal as cancellation, return it as normal tool content, and include structured
  details; do not throw merely because user cancellation occurred.
- For a nonzero exit, return a normal, concise result with `ok: false`, `code`,
  `stdout`, and `stderr` in `details`; throw only for extension/program-launch
  failures where Pi must mark `isError`. This preserves terminal-browser diagnostics
  without claiming success.
- Bound **each** stdout/stderr field and the composed LLM text with Pi's exported
  truncators, at 50 KB/2,000 lines or a smaller documented cap. State which stream
  was truncated, original byte/line totals, and that the full output was not saved
  unless implementation actually writes a secure, documented file. Never put
  unbounded output in `details`, since persisted tool details can also bloat state.
- Always call `action done` only when explicitly requested; do not hide it in a
  `finally` block. The existing skill's ownership contract says explicit `done`
  releases control after final action or failure. [Skill](../../config/skills/terminal-browser/SKILL.md).

### Required wording and routing

Suggested tool description:

> Control the human-visible terminal-browser tab for fast shared feedback. Use for
> user-requested co-browsing and direct interaction with the agent-targeted visible
> window; Ctrl+G can hand a selected element's DOM/React/source context back to the
> agent, avoiding screenshot-loop investigation. Announce control, keep the shared
> tab untouched by others, and finish with `done`. Use browser-goblin instead for
> autonomous testing, debugging, visual QA, or unattended browsing.

Suggested active-tool guideline: “Use `terminal_browser` only for a
human-requested visible co-browsing tab; use browser-goblin for autonomous browser
work, and call `terminal_browser` with `done` when control ends.” This naming is
important because Pi appends guidelines without a tool-name prefix.

## Required implementation checks (recommendation)

1. **Module evaluation:** enabled Pi + terminalBrowser yields binary, skill,
   extension link, and kitty graphics only with Herdr; disabled Pi or terminalBrowser
   yields none of those additions. Extend existing `checks.nix` assertions.
2. **Extension load smoke:** copy the local extension into a temporary directory,
   link only Pi's core peer modules (as existing lazy-tools check does), run Pi
   offline with ambient extensions/skills/context disabled, and reject loader errors.
3. **Lazy-tools self-check:** represent `terminal_browser` at a source path
   containing the chosen `browser` marker. Verify initial deferral and exactly the
   browser-group activation.
4. **Package smoke:** retain existing `terminal-browser-smoke`; add an extension
   wiring assertion rather than changing package source. Verify the extension output
   does not introduce `node_modules`.
5. **Unit-level executor fixture:** mock `pi.exec`; assert every action becomes the
   table's literal argv, no action accepts arbitrary argv, the fixed executable is
   used, the received signal is forwarded, and stdout/stderr/nonzero/killed/truncated
   results are bounded and classified as designed.

## Prototype unknowns — do not encode as a contract yet

- Ctrl+G transport is terminal-browser/Herdr pane text, not a Pi extension API.
  Existing handoff research found no acknowledgement that Pi accepted it, no check
  of Pi's active turn/tool/confirmation state, and no observation of its outcome
  during streaming. [Existing handoff report](terminal-browser-handoff-contract.md).
- Pi's native `sendMessage` can queue a custom message as `steer`, `followUp`, or
  `nextTurn`; `sendUserMessage` requires a delivery mode while streaming.
  [Pi message delivery API][pi-ext-messages]. That proves Pi has queue semantics
  **inside** an extension, but does not prove Ctrl+G's external bracketed-paste
  bytes enter that queue.
- Prototype with a real sibling Herdr/Pi pane in idle, streaming, tool-running,
  and confirmation states. Capture exact Ctrl+G bytes and whether they become
  composer text, a submitted message, queued steering, or terminal debris. Also
  test tool cancellation while `terminal_browser` is waiting. Keep the first tool
  synchronous and non-listening: no background watcher or inferred feedback channel
  until these observations establish an authenticated delivery/acknowledgement seam.

## Sources

### Primary sources

- [Pi extension documentation, installed with active Pi 0.85.1][pi-ext-all] and
  [upstream source][pi-ext-upstream]
- [Pi skill documentation, installed with active Pi 0.85.1][pi-skills]
- [Pi package documentation, installed with active Pi 0.85.1][pi-packages]
- [Pi `ToolDefinition` declaration, installed with active Pi 0.85.1][pi-ext-api] and
  [the matching `ExecResult` declaration][pi-exec-api]
- [Nixpkgs `callPackage` implementation][nix-callpackage]
- [terminal-browser v0.8.1 source][terminal-browser-upstream]

### Repository evidence

All repository citations above are primary project sources at the inspected
baseline or current corrected worktree: `config/extensions/lazy-tools/`,
`modules/pi-coding-agent.nix`, `packages/terminal-browser.nix`, `checks.nix`,
`pi-plugins.json`, and the two named `.pi/rules/` files.

[pi-ext-quick]: https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#quick-start
[pi-ext-tool]: https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#tool-definition
[pi-ext-output]: https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#output-truncation
[pi-ext-context]: https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#ctxsignal
[pi-ext-active]: https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#pigetactivetools--pigetalltools--pisetactivetoolsnames
[pi-ext-dynamic]: https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#dynamic-tool-loading
[pi-ext-messages]: https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#pisendmessagemessage-options
[pi-ext-all]: /nix/store/qf702rins357mp8jlr1s5k1s3kp2d2ms-pi-coding-agent-0.85.1/lib/node_modules/pi-monorepo/docs/extensions.md
[pi-ext-api]: /nix/store/qf702rins357mp8jlr1s5k1s3kp2d2ms-pi-coding-agent-0.85.1/lib/node_modules/pi-monorepo/dist/core/extensions/types.d.ts
[pi-ext-upstream]: https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md
[pi-skills]: /nix/store/qf702rins357mp8jlr1s5k1s3kp2d2ms-pi-coding-agent-0.85.1/lib/node_modules/pi-monorepo/docs/skills.md
[pi-packages]: /nix/store/qf702rins357mp8jlr1s5k1s3kp2d2ms-pi-coding-agent-0.85.1/lib/node_modules/pi-monorepo/docs/packages.md
[pi-exec-api]: /nix/store/qf702rins357mp8jlr1s5k1s3kp2d2ms-pi-coding-agent-0.85.1/lib/node_modules/pi-monorepo/dist/core/exec.d.ts
[nix-callpackage]: https://github.com/NixOS/nixpkgs/blob/master/lib/customisation.nix#L227-L264
[terminal-browser-upstream]: https://github.com/zenbu-labs/terminal-browser/tree/b16b8574a026ba0ef451e7e377e12b5747c47706

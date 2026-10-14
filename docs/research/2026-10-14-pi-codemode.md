# pi codemode — sandboxed scripted tool orchestration (research, 2026-10-14)

Question: is pi's `codemode` tool a good alternative to bash-fu / inline Python for complex flows, given the user cares about its sandboxed nature? Researched against the installed pi 1.0.0 and 1.1.0 store paths, this repo's modules/extensions, and upstream `badlogic/pi-mono`.

Verified upstream identity: `github.com/badlogic/pi-mono` is the source repo for npm package `@earendil-works/pi-coding-agent` (packages table lists `packages/coding-agent` → "Interactive coding agent CLI"). Source: <https://github.com/badlogic/pi-mono> (README packages table; fetched 2026-10-14).

All local line numbers refer to the cited file at its store path.

---

## 1. What codemode is (mental model)

`codemode` is a built-in extension tool (`builtin:codemode`, loaded by default but **registered inactive**) that takes **raw JavaScript source** as input and runs it as the body of an async function inside a QuickJS sandbox. The script calls pi's other tools via `await tools.<name>({...args})` and non-LLM models via `models.*`. Only the **script's output** (`text()`, `console.*`, `image()`, top-level `return`) reaches the model; nested tool results do not enter the transcript.

- pi 1.0.0 docs: `/nix/store/4124kgrxxngakwm8nw2gkvzz7f6ad6cq-pi-coding-agent-1.0.0/lib/node_modules/pi-monorepo/docs/codemode.md` L3: "The `codemode` tool lets the model write a JavaScript script that calls pi's other tools… Only the script's output reaches the model, so a script can run calls in parallel and filter large results before the model sees them." L7: sandbox has "no Node APIs, file system, network, or timers; scripts reach the outside world only through tools and `models`."
- Difference vs bash/python: a bash call's full stdout **becomes a transcript entry the model must read** (and bash output is capped at 2000 lines / 50KB for the model). In codemode, ten parallel tool calls happen inside one tool call, and the script decides what to print: "Run JavaScript that calls other tools" + "Use codemode to batch independent tool calls (Promise.allSettled), chain them, or filter large output, instead of many separate calls." (`dist/extensions/codemode/tool.js` L47-52, system-prompt contribution in pi 1.0.0.)
- Data flow detail: nested calls run through `ctx.executeTool` — the agent loop's full tool pipeline: "validation, `tool_call`/`tool_result` hooks, and permission checks apply exactly as for direct calls. Only the script's output reaches the model; nested results do not." (`dist/extensions/codemode/tool.js` L7-10.)
- What a call resolves to (`docs/codemode.md` L41-47): tools with an `outputSchema` resolve to `structuredContent`; `bash` resolves to `{ output, truncated, full_output_path?, exit_code, wall_time_seconds }` — its `output` "is not limited to the 2000 lines or 50KB the model sees: it holds up to 1 MiB" (first/last 512 KiB around an omission marker beyond that). MCP tools resolve to their `CallToolResult`; other tools resolve to their text output. Failures reject with an Error carrying the tool's error text; `Promise.allSettled()` keeps partial success.

## 2. Sandboxing: guarantees and non-guarantees

**Isolation mechanism** (`node_modules/@earendil-works/pi-codemode/dist/runtime/host.js` L44-48, L229-237; `runtime/worker.js` L1-12, L47-57): each script gets a **fresh worker thread + fresh QuickJS VM** (separate `quickjs-wasi` wasm instance). The host terminates the worker when the script settles, times out, or is aborted, so "a runaway script, including one that only spins the microtask queue, is killed with `terminate()` and cannot poison a later run." The VM is created with `memoryLimit`, `maxStackSize`, and an `interruptHandler` backed by a shared `SharedArrayBuffer`; engine fd 1/2 output is discarded so it cannot pollute the host TUI.

**Guaranteed (for the script's JS):**
- No Node APIs, `require`, modules, `fetch`, `process`, fs, network, or timers (host.js L229-237; `docs/codemode.md` L7). `console` is the pi-provided helper, not Node's.
- 256 MB VM heap limit — `CODEMODE_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024` (`dist/extensions/codemode/execute.js` L18-23); overrun throws `InternalError: out of memory` inside the script, not in pi.
- Only escape hatches are injected: `tools.<name>` for every callable tool, and the `models` global. Even `models` is credential-safe: `toModelInfo` deletes `headers` from catalog entries ("models.json headers can carry credentials", execute.js L56-61) and `runModelCall` resolves models through the registry only — "A script-supplied baseUrl or headers must never receive the credentials" (execute.js L465-477).
- A script waiting on a promise that can never settle (no tool call pending) fails immediately — `stalled()` in the prelude, since there are no timers (`docs/codemode.md` L206; prelude header comment).
- Scripts cannot start other codemode scripts: the tool has `exposure: "model-only"` and `getCodemodeCallableTools()` filters the codemode tool itself out of the script's tool table (`tool.js` L84-87, L244-245; `docs/codemode.md` L207).
- Output is capped: default `max_output_tokens` 10000 (~40KB); excess keeps head+tail and spills the full text to a temp file whose path is returned (`docs/codemode.md` L15; execute.js L186-249, `spillOutput` → `pi-codemode-<hex>.txt` in tmpdir).
- `store()`/`load()` limits: one value ≤ 262,144 chars of JSON, total ≤ 1,048,576 (`MAX_STORE_VALUE_CHARS`/`MAX_STORE_TOTAL_CHARS`, pi-codemode `dist/runtime/prelude-source.js` L28-29; `docs/codemode.md` L57). Writes persist only when the script **succeeds**, as `codemode-store` custom session entries, so each branch sees only its own writes (execute.js L172-185, L345-349; `docs/codemode.md` L55).
- Timeout via `// @options: {"timeout_ms": N}` — a hard deadline producing `Script timed out` + partial output (`docs/codemode.md` L16, L18). Nuance in pi 1.0.0: pi passes `timeoutMs: sourceOptions.timeoutMs ?? Number.POSITIVE_INFINITY` (execute.js L326), overriding the sandbox class's own 300s default (host.js L5) — **without `@options`, a pi 1.0.0 script runs until it finishes or the user aborts (Esc → `Script aborted`)**.
- Failure semantics: "A failed script keeps its partial output, followed by `Script error:` and the error. Tool calls are real: calls made before a failure are not undone. Calls still running when the script ends are cancelled, and unawaited promises are discarded." (`docs/codemode.md` L18; cancelled marking at execute.js L339-343.)

**NOT guaranteed (the crucial caveat):**
- **The sandbox contains the script's JavaScript, not the tools it calls.** `tools.bash()` inside a script is real bash on the host with the session user's permissions; `tools.write()` really writes. Nested calls deliberately go through the real tool pipeline including permission gates (`tool.js` L7-10; `docs/mcp.md` L228: "Every MCP call passes through Pi's tool pipeline… permission gates… apply to MCP tools"). Codemode is a **context-window and orchestration** tool, not a privilege boundary. pi's own security doc scopes the security boundary accordingly (`docs/security.md` L16, L99).
- The JS sandbox itself is quickjs-wasi in-process wasm — strong for memory/CPU runaway, and pi-codemode's changelog shows they patch realm-boundary bugs (e.g. built-ins frozen in 1.0.4, see §6).

## 3. How to enable

- Persistent, user level: `~/.pi/agent/settings.json` → `"defaultTools": ["+codemode"]`. Project level: `<repo>/.pi/settings.json` same key. `+name` entries change the inherited default selection (`read`, `bash`, `edit`, `write`) instead of replacing it (`docs/cli.md` L148-156; `docs/settings.md` L40, L44-52).
- One-shot, pi 1.0.0: `pi --tools read,bash,edit,write,codemode` — "For one invocation, list every tool, since `--tools` replaces the selection" (`docs/cli.md` L158-162). In 1.1.0+ `--tools +codemode` works (upstream changelog 1.1.0: "Added `+name` and `-name` entries to `--tools`").
- `codemode.mode` (`docs/settings.md` L41): `"on"` (default) keeps declared tools declared and appends "Codemode: `tools.x(args)` resolves to …" to their descriptions; `"only"` hides active direct tools from the model and lists everything in the codemode description instead (`tool.js` L194-234 `prepareCodemodeLoadout`).
- `codemode.inlineBudget` (default 3000 estimated tokens, `docs/settings.md` L42): token budget for tool declarations inlined into the codemode description; tools that don't fit are found via `searchTools()`.
- Built-in extension toggles: `builtin:codemode` in `extensions`; loads by default (`docs/settings.md` L160).
- MCP interplay: the **built-in** MCP extension auto-activates codemode when a `codemode`-exposure server connects; `"autoEnableCodemode": false` beside `mcpServers` stops that, and pi warns once when neither codemode nor tool_search is active but non-direct tools exist (`docs/mcp.md` L182, L206). This repo disables builtin MCP (`extensions = [ "-builtin:mcp" ]`, `modules/pi-coding-agent.nix` L343-345) and uses pi-mcp-adapter, whose server entries default to `exposure: "codemode"` (adapter `config.ts` L1244: `exposure === undefined || "codemode-deferred" ? "codemode"`) — so with the adapter, MCP tools are already script-callable once codemode is enabled. Whether the adapter (vs builtin MCP) auto-activates codemode is not verified from source; treat as unverified.

## 4. Complex-flow patterns it enables

- **Parallel fan-out**: `await Promise.allSettled([...])` over many `tools.*` calls in one model turn (`docs/codemode.md` L47; `docs/cli.md` L145).
- **Filter/aggregate before the model sees data**: bash output up to 1 MiB to the script vs 50KB/2000 lines to the model on a direct call (`docs/codemode.md` L43); scripts grep/join/slice and return only the summary. MCP text results >20KB are middle-truncated for the model, but "Codemode scripts receive the complete result and can reduce it" (`docs/mcp.md` L208).
- **Tool discovery**: `ALL_TOOLS`, `searchTools(query, {limit?, namespace?})` (BM25, default limit 8), `describeTool(name)`, `describeNamespace(name)` (`docs/codemode.md` L31-34; implementation `dist/extensions/codemode/execute.js` L390-456). Deferred-exposure tools are never in the description, so it stays stable while MCP servers connect (`tool.js` L120-127).
- **Cross-call state**: `store(key, value)` / `load(key)` persisted as `codemode-store` session entries per branch; good for IDs/cursors/summaries (`docs/codemode.md` L53-57).
- **Non-LLM models**: `models.getModelsOfType/getAvailableOfType/getModelOfType`, `models.classify(model, {state, questions})` (typed choice/score/bool questions, one call answers all questions), `models.generateImages(model, {input})`. Max **4 concurrent** classify/image calls per script; extra calls queue (`MAX_CONCURRENT_MODEL_CALLS = 4`, execute.js L17; `docs/codemode.md` L92). Usage is added to the codemode result and counts toward session cost (`docs/models.md` L136).
- Output ergonomics: `text()`/`image()`/`return`/`console.*`; `image()` accepts base64 data URLs or image blocks (PNG/JPEG/GIF/WebP, no remote URLs); `exit()` ends early (`docs/codemode.md` L24-29).

## 5. Interaction with THIS fleet's config

**lazy-tools** (`config/extensions/lazy-tools/index.ts`): defers groups by *deactivating* tools at `session_start` (L101-105) and blocking direct calls to not-yet-loaded group tools via a `tool_call` hook (L75-83); `load_tools(group)` activates them (L52-70).

- pi's callable set for scripts = exposure `codemode`/`deferred` (callable regardless of active state) **plus** active `direct` tools — `AgentSession._getCallableTools`: `exposure === "codemode" || exposure === "deferred" || (exposure === "direct" && active.has(tool.name))` (`dist/core/agent-session.js` L1109-1114, pi 1.0.0).
- Fleet extension tools register with pi's default exposure `direct`, so **a deferred (unloaded) lazy-tools tool is NOT callable from codemode scripts** — it is not in the sandbox tool table at all. Once the group is loaded, it becomes script-callable. Conclusion: codemode does **not** bypass lazy-tools deferral; `load_tools` stays the gate. (No lazy-tools change needed — codemode is a built-in tool, not a deferrable group, so the `.pi/rules/pi-plugin-lazy-tools.md` self-check rule is not triggered.)
- `tool_search` is a separate built-in, registered inactive; enabling codemode does not enable it. Scripts' `searchTools()` only ranks *callable* tools.
- One wrinkle: with codemode enabled, the model may try `tools.<deferred-name>()` in a script and get a plain unknown-tool error instead of lazy-tools' helpful "call load_tools first" block message (the block hook only fires for calls that reach the tool pipeline). Cosmetic, not a bypass.

**pi-herdr-subagents children**: frontmatter `tools:` → `buildSubagentToolAllowlist()` force-adds `SUBAGENT_CONTROL_TOOLS`, then the spawn gets `pi --tools <allowlist>` (replaces selection) **and** `PI_SUBAGENT_ALLOWED_TOOLS=<allowlist>` (`/nix/store/b62qyxr5rfv722ygpix5n5kwwv6kbpjw-pi-herdr-subagents-0.2.1/lib/node_modules/pi-herdr-subagents/pi-extension/subagents/harness/drivers/pi.ts` L12-26, L112-115, L128-131).

- The nix module renders that frontmatter from `tools.allow ∩ supportedTools`, where `supportedTools = [read bash edit write grep find ls subagent]` (`modules/pi-coding-agent/pi-herdr-subagents.nix` L9-18, L27-29, L54). **`codemode` is not in `supportedTools`**, so putting `"codemode"` in an agent's `tools.allow` today is silently intersected away. Children get codemode only if `supportedTools` gains `"codemode"` (and the child's `default-agents.nix` `tools.allow` lists it, e.g. implementer/support).
- The managed-policy patch only reroutes `loadAgentDefaults()` for the six managed agent names through `$configDir/agents/<name>.md` (`packages/pi-herdr-subagents-managed-policy.patch` L23-43); it does not touch the tools.allow → spawn-flag flow. The rendered `tools:` frontmatter remains the single source.
- Note `--tools <plain list>` in the child replaces the whole selection, so a child allowlist including `codemode` gets codemode plus exactly the listed tools — no lazy-tools deferral issue there either (children set `childAllowedTools`, which also disables the block hook, `lazy-tools/index.ts` L76).

## 6. pi 1.0.0 vs 1.1.0 codemode differences

pi 1.0.0 bundles `@earendil-works/pi-codemode` **1.0.0**; pi 1.1.0 bundles **pi-codemode 1.1.0** (package.json version check across both store paths). pi-codemode changelog (bundled at `…pi-coding-agent-1.1.0/.../@earendil-works/pi-codemode/CHANGELOG.md`):

- **1.0.1 (2026-10-03)** — scripts printing in a loop grew host memory until crash; output now capped at `MAX_OUTPUT_CHARS` (16 Mi chars) / `MAX_OUTPUT_ITEMS` (100000), failure = `RangeError` (#10283). *Missing from pi 1.0.0's prelude (no `MAX_OUTPUT_CHARS`); present in 1.1.0's.*
- **1.0.4 (2026-10-05)** — built-ins frozen and built-in globals read-only before the script runs; a script patching `Array.prototype.toJSON` previously crashed the host and left `execute()` unsettled; malformed payloads now fail as a sandbox error (#10444). *Missing from pi 1.0.0.*
- **pi-codemode 1.1.0** — `console: true` flag on console output items.

pi-coding-agent changelog (<https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/CHANGELOG.md>), codemode-relevant deltas 1.0.0 → 1.1.0:

- 1.0.3: `image()` also saves each image to a temp file and names the path; output files user-readable only.
- 1.0.4: `tools.read()` on an image file returns an image block usable by `image()`; `--tools` keeps MCP tools unless an entry starts with `mcp__`; codemode shows each tool's prompt guidelines with its declaration; fixed built-in patching (same as pi-codemode 1.0.4).
- 1.1.0: `models.classify()` accepts `images` (GPT-6 Luna image classification); `--tools +name/-name` (`pi -t +codemode`); fixed the codemode description not marking `searchTools()`/`describeTool()`/`describeNamespace()` as `async` (#10555); fixed output items running together — now `==> text N/M <==` separators and one `<console_output>` block (#10555 family).
- Documented new limits in 1.1.0's `docs/codemode.md` L15: output past 16,777,216 chars or 100000 items fails the script.
- Later (1.2.0, 2026-10-12, beyond this comparison): declarations show input constraints (`@` tags), elapsed/total time rows, `// @options:` not on the first line now fails fast instead of silently ignoring `timeout_ms` (#10631), quadratic output-join fix (#10678), "broken bridge" fix under `node --watch` (#10725); Unreleased: Bun deadline/worker-accumulation fixes (#10748).

Net: **pi 1.0.0 (current on hosts) ships the two known pi-codemode hardening bugs** (host-memory growth on print loops; built-in patching crash). Neither is a sandbox escape, but both can take the pi process down. pi 1.1.0 fixes both.

## 7. Recommendation for this repo

**Enable, but land it after the 1.1.0 deploy.**

1. **Where**: `programs.pi-coding-agent.settings` is a freeform JSON attrset merged into `settings.json` (`modules/pi-coding-agent.nix` L925-930; arbitrary keys accepted — see `checks.nix` L105-110). Add to `defaultSettings` (`modules/pi-coding-agent.nix` L327-352):
   ```nix
   defaultTools = [ "+codemode" ];
   ```
   Keep defaults for `codemode.mode` (`"on"`) and `codemode.inlineBudget` (3000). This preserves `read`/`bash`/`edit`/`write` and adds codemode fleet-wide; pilot first via this repo's `.pi/settings.json` if preferred.
2. **Version gate**: rely on the existing pi version pin (`pinnedPkgs.pi-coding-agent`, L924). Enable codemode in the same change that moves hosts to 1.1.0+ — pi 1.0.0's bundled sandbox lacks the 16Mi output cap and frozen built-ins (#10283, #10444).
3. **Subagents**: if children should script too, add `"codemode"` to `supportedTools` in `modules/pi-coding-agent/pi-herdr-subagents.nix` L9-18 and to the relevant `tools.allow` lists in `modules/pi-coding-agent/default-agents.nix`; do this deliberately (implementer/support yes; scout/read-only no).
4. **Checks** (per CODING_STANDARDS.md: "add or update checks.nix assertions for changed module behavior including disabled output"):
   - Update the exact-settings assertion `default.config.programs.pi-coding-agent.settings == { … }` (`checks.nix` L509ff) to include `defaultTools = [ "+codemode" ]`.
   - If/when `supportedTools` changes, add an assertion that every pi-herdr-subagents agent's `tools.allow` entries are actually representable (i.e. `tools.allow ⊆ supportedTools ∪ {null}`) so a requested `codemode` can never be silently dropped by `resolveTools` again.
   - No lazy-tools self-check change: codemode is not a deferred group; verify the deferred-not-callable-from-scripts property once with a manual check after enabling.
5. **Usage guardrail**: document in `config/AGENTS.md`-adjacent rules that codemode scripts calling `tools.bash` are *not* sandboxed bash substitutes — destructive-action confirmation rules apply to script-issued tool calls exactly as to direct ones.

---

*Location note: `docs/research/` is a new convention for this repo — first file here; `docs/` previously contained only `agents/`.*

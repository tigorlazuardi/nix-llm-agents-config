# Coding Standards

## Formatting

Nix formatting is enforced by `nixfmt` through `checks.x86_64-linux.formatting`; do not restate or hand-tune formatter rules.

## Names and seams

- Name Nix files with lowercase kebab-case (`pi-coding-agent.nix`, `pi-usage.nix`); use camelCase for Nix bindings and option names.
- Keep Home Manager integration in `modules/`; split its focused submodules under `modules/pi-coding-agent/`. Export only `homeManagerModules.default` from `flake.nix`.
- Put one external plugin/local extension package definition in `packages/<alias>.nix`; keep its adjacent lockfile and narrowly scoped hardening patch there when needed.
- Use native Home Manager/Pi options for supported configuration. Link only unsupported native-layout resources from `config/` with `home.file`; do not give one target two declarative owners.
- Keep `settings.packages` exclusively module-owned and pass built plugin closures as immutable local paths. Do not use user-level npm installs, shared dependency bundles, or imports from Pi's Nix-store internals.

## Reproducibility and Nix

- Pin every fetched source with its exact `hash`. npm URLs contain exact versions, never ranges; git sources contain exact `rev`, reviewed `track`, and `hash`.
- For npm dependency closures, commit exact adjacent lock metadata and `npmDepsHash`. Do not add registry knobs or builder overrides without demonstrated package need.
- Preserve current option semantics: defaults use `lib.mkDefault`, effects depending on Pi use `lib.mkIf cfg.enable`, and invalid cross-option combinations fail with `assertions` and actionable messages.
- Before adding/changing Nix packages, verify package name, availability, and options with NixOS MCP. Before adding/changing Nix functions, verify signature and behavior with Noogle MCP; failed lookup requires upstream-doc verification, never guess.

## Boundaries and errors

- Use terms in `CONTEXT.md`; read it before domain work and surface ADR conflicts rather than silently overriding them.
- Managed configuration is portable and declarative. Keep authentication, sessions, logs, caches, crash/trust state, generated npm/git state, and other mutable Pi runtime state local.
- Secret references are runtime file paths only. Never read secret content during evaluation or activation; never place it in Git, generated JSON/configuration, Pi environment, or Nix store. Use native MCP file-env wrappers; do not replace them with `builtins.readFile`.
- Do not recreate paths Home Manager already owns, add writable copies/raw-resource templating, or manage a repository-level `.mcp.json`/`.pi/mcp.json`.

## Checks

- Add or update `checks.nix` assertions for changed module behavior, including enabled and disabled output where relevant.
- Add isolated offline load smoke checks for changed packages/extensions: use temporary runtime directories, disable ambient Pi resources, reject loader errors, and verify package output has no unintended `node_modules` closure.
- Run applicable `nixfmt`/`checks.x86_64-linux.formatting` validation and `nix flake check`; focused package checks may supplement, not replace, public acceptance checks.

## Comments and prohibitions

- Comments explain a non-obvious constraint, security boundary, or deliberate shortcut—not code mechanics. Mark accepted bounded shortcuts with `ponytail:` plus ceiling and upgrade path.
- Do not add speculative fields, abstractions, resource filters, autoload controls, configuration options, or dependencies without concrete need.
- Do not treat external PRs as issue-tracker triage; GitHub Issues use canonical labels from `docs/agents/triage-labels.md`.
- Never expose API keys, auth material, runtime secret content, or arbitrary credential-bearing command output in repository files, checks, or update summaries.

The Fowler smell baseline from the `code-review` skill still applies below these standards. Where this document and the baseline disagree, this document wins.

First ticket touching an area sets its living pattern. Review later code against both this document and that ticket's produced code; disagreement signals standards update, not automatic code fault.

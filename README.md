# nix-llm-agents-config

Personal reusable Home Manager configuration for Claude Code and Pi coding agent, consuming latest agent packages from [`github:numtide/llm-agents.nix`](https://github.com/numtide/llm-agents.nix). Intended for homeserver, boxes, and future NixOS desktop.

## Pi compaction policy

`programs.pi-coding-agent.plugins.pi-vcc.settings.autoCompaction` controls algorithmic automatic compaction from settled-turn context usage. The default absolute threshold is 150,000 tokens. Model IDs may override it through `modelThresholdTokens`; the managed CC Haiku model uses 136,000 tokens while Fable, Opus, and Sonnet use 150,000.

This context-rot policy is independent from Pi's `reserveTokens` and model output limits. Pi-vcc suppresses earlier reserve-based threshold attempts, evaluates only after `agent_settled`, and preserves Pi's native overflow recovery. If a configured threshold is not below the active model's context window, Pi's native safety behavior remains active.

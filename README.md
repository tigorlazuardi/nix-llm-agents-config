# nix-llm-agents-config

Personal reusable Home Manager configuration for Claude Code and Pi coding agent, consuming latest agent packages from [`github:numtide/llm-agents.nix`](https://github.com/numtide/llm-agents.nix). Intended for homeserver, boxes, and future NixOS desktop.

## Pi compaction policy

Pi-vcc replaces Pi's default compaction (`overrideDefaultCompaction`), keeps extra recent turns when their token cost fits (`smartKeepTail`), and optionally continues the agent after compaction (`continueAfterThresholdCompact`). Automatic threshold-based compaction is intentionally not configured; compaction is manual.

---
paths: "{pi-plugins.json,packages/*.nix,modules/pi-coding-agent.nix,config/extensions/lazy-tools/**}"
---
When adding or enabling a Pi plugin, inspect its registered tools. Defer tools that need not be available every turn through `lazy-tools`; keep commands and runtime-critical hooks eager.

Add or update the `lazy-tools` self-check for every deferred tool group.

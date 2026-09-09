---
name: terminal-browser
description: Visible human review and co-browsing in a terminal companion pane, including Ctrl+G element handoff. Use browser-goblin instead for autonomous browser testing and QA.
---

# Terminal browser

Use terminal-browser only for a visible, human-in-the-loop tab. Route autonomous testing, debugging, visual QA, and unattended browser work to browser-goblin.

1. Verify Herdr and kitty graphics are available. If pane splitting or graphics support is absent, report that prerequisite explicitly and stop.
2. Open the shared page beside the user:
   ```sh
   terminal-browser open --split right <url>
   ```
3. Announce agent control before acting. The human and browser-goblin must leave this tab untouched until release.
4. Use `terminal-browser action -- snapshot`, then `click`, `fill`, or `eval` as needed. Keep every action on the same visible tab; inspect `terminal-browser ls` when target selection is ambiguous.
5. Run `terminal-browser action done` after the final action or immediately after a failure. Announce that control is released.

Ctrl+G on a selected element sends its DOM, React, and source context to the detected agent pane. Treat that handoff as the user's requested target, then follow the ownership sequence above.

This installation is Nix-managed. Use `terminal-browser help` and `terminal-browser action --help` for current syntax. Setup and upgrades belong in Nix configuration; use no installer, self-upgrade, or `terminal-browser setup` command.

---
name: homelab-flake-update
description: Handoff flake-relevant pushes to the homelab agent through intercom. Use after a successful push changes any path outside `.pi/`.
---

# Homelab flake update

After pushing commits from this repository:

1. Resolve pushed range and exhaustive changed-path list.
2. Classify push:
   - **local-only:** every changed path is under `.pi/`; handoff is complete.
   - **flake-relevant:** at least one changed path is outside `.pi/`; continue.
3. For a flake-relevant push, confirm remote contains full commit SHA. Send the `homelab` agent one `intercom` message containing:
   - repository and full commit SHA;
   - concise content change;
   - checks run, failures, and skips;
   - request to update flake pin and switch when safe.

   Relay peers advertise working paths, not agent names: pick the peer whose address path is this server's homelab checkout — it ends in `/homelab@<host>` (list with `list_peers`).

   Take the full SHA from `git rev-parse HEAD` output pasted into the message — never typed from memory. Two handoffs sent recalled SHAs that were wrong (`104a067c` vs real `104a0672…`, `3438e6bce…` vs real `3438e6b9…`) and the consumer had to resolve or reject them manually.
4. Successful tool delivery completes handoff. Deployment confirmation remains separate unless user requested deployment verification.

When `intercom` is unavailable for a flake-relevant push, report pending handoff explicitly.

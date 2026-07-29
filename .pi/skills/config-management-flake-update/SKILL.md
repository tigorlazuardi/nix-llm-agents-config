---
name: config-management-flake-update
description: Notify config-management after a successful push from a repository consumed as a flake, when the intercom tool is available, so downstream pins stay current.
---

# Config-management flake update

After pushing a commit from a flake source repository:

1. Resolve the pushed repository, branch, and full commit SHA. Continue only after the remote contains that commit.
2. When the `intercom` tool is available, send `config-management` one message containing:
   - repository name and full commit SHA;
   - concise behavior change;
   - checks run and exact failures or skips;
   - request to update the flake pin and switch when safe.
3. Treat successful tool delivery as handoff completion. Deployment confirmation is separate; wait for it only when the user requested deployment or verification.

When `intercom` is unavailable, report the pending config-management handoff explicitly. Never claim notification was sent.

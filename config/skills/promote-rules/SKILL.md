---
name: promote-rules
description: Promote an approved, concrete convention into narrowly path-scoped `.pi/rules/`. Use when the user asks to add, preserve, or promote a project rule; when another skill identifies durable path-specific guidance; or when `/promote-rules` is invoked.
---

# Promote rules

1. Confirm guidance is concrete and path-scopable. If it is intent-triggered or cross-cutting, use `promote-skills` instead; load `writing-for-agents` before writing the skill.
2. Read only relevant existing rules. Reuse one when scope and topic match.
3. Choose narrowest repository-relative `paths` glob covering target files. Different scopes → separate rule files.
4. Draft few direct, actionable lines. Show full draft and path; write only after explicit approval.
5. Verify each rule says something future agents would otherwise miss.

```md
---
paths: "src/target/**/*.ts"
---
Use <specific project convention>.
```

Keep rule files short. Split by target scope, not into long catch-all guidance.

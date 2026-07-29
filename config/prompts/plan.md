---
description: Break a task into steps, files, acceptance before coding
argument-hint: "<task>"
---
Plan this task before any code: $@

Output:
1. Goal — one sentence.
2. Approach — chosen path + one-line why; note alternatives rejected.
3. Steps — ordered, each: what + which files touched.
4. Files — list paths to create/edit.
5. Acceptance — how we verify done (tests, commands, observable behavior).
6. Risks / open questions.

Do NOT write code yet. Keep it tight. If the task is trivial (1-2 files, no design call), say so and skip the ceremony.

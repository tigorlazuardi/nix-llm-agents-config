---
paths: "docs/src/content/docs/**/*.mdx"
events:
  tool_call:
    - edit
    - write
skills: astro-docs-authoring
---
Load linked Astro/Starlight MDX authoring reference before writing matching docs.

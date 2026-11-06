---
name: dashboard
description: "Build / check the GraphReFly internal docs dashboard (jsonl single-source → generated HTML with progress, structure map, gaps, search). Use when the user wants to see global project state, regenerate the dashboard, run the docs consistency gate (broken links / orphans / coverage gaps), or after editing any jsonl in ~/src/graphrefly (decisions/plan/spec/sessions/guide). Triggers: 'build the dashboard', 'check docs consistency', 'what are the gaps', 'show progress', 'regenerate dashboard', 'doc gate'."
---

Read and follow the canonical GraphReFly workflow at
`~/src/graphrefly/.agents/skills/dashboard/SKILL.md`.
Pass the user request, arguments, and target runtime through unchanged. The protocol workflow is
owned by the language-neutral repository; this package entrypoint has no separate policy.

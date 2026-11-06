---
name: dashboard
description: "Build / check the GraphReFly internal docs dashboard (jsonl single-source → generated HTML with progress, structure map, gaps, search). Use when the user wants to see global project state, regenerate the dashboard, run the docs consistency gate (broken links / orphans / coverage gaps), or after editing any jsonl in ~/src/graphrefly (decisions/plan/spec/sessions/guide). Triggers: 'build the dashboard', 'check docs consistency', 'what are the gaps', 'show progress', 'regenerate dashboard', 'doc gate'."
argument-hint: "[--check (gate only) | (default: build + report)]"
---

Read and follow [the maintained dashboard workflow](../../../.agents/skills/dashboard/SKILL.md).
Resolve that path relative to this file and pass the user request and arguments through unchanged.
This entrypoint has no separate protocol, decision, work, or review policy.

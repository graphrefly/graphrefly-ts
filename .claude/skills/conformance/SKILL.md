---
name: conformance
description: "Behavioral conformance check across GraphReFly language runtimes (ts/rust/py) for the clean-slate redesign. Replaces the old structural 'parity' diff. Parity = does each runtime satisfy the wave-protocol behavior (conformance scenarios) + dispatcher contract — NOT 'do the symbol sets match'. Use after implementing/changing substrate behavior in any runtime, or when adding a new protocol rule. Authors/runs language-agnostic scenarios and reports exact source-bound evidence. Triggers: 'conformance', 'cross-lang check', 'does rust match', 'parity', 'run the conformance suite', 'is the substrate behavior consistent'."
argument-hint: "[rule-id | scenario-id | 'full'] [optional: runtime ts|rust|py]"
---

Read and follow [the maintained conformance workflow](../../../.agents/skills/conformance/SKILL.md).
Resolve that path relative to this file and pass the user request and arguments through unchanged.
This entrypoint has no separate protocol, decision, work, or review policy.

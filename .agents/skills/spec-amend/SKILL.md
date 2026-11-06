---
name: spec-amend
description: "Spec-first protocol amendment flow for the clean-slate GraphReFly redesign. Use BEFORE changing any wave-protocol behavior (tiers, wave semantics, diamond/equals/SENTINEL, batch, push-on-subscribe, ctx.up/down contract). Enforces F-NO-IMPL-DEFINED: amend spec/rules.jsonl + formal/*.tla + spec/conformance.jsonl FIRST, then implement in each language package. Triggers: 'amend the spec', 'change the protocol', 'add a tier', 'spec change', 'new wave rule', 'this changes protocol behavior'. Not for purely package-local sugar/operator/inspection changes that preserve protocol behavior."
---

Read and follow the canonical GraphReFly workflow at
`~/src/graphrefly/.agents/skills/spec-amend/SKILL.md`.
Pass the user request, arguments, and target runtime through unchanged. The protocol workflow is
owned by the language-neutral repository; this package entrypoint has no separate policy.

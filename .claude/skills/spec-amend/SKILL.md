---
name: spec-amend
description: "Spec-first protocol amendment flow for the clean-slate GraphReFly redesign. Use BEFORE changing any wave-protocol behavior (tiers, wave semantics, diamond/equals/SENTINEL, batch, push-on-subscribe, ctx.up/down contract). Enforces F-NO-IMPL-DEFINED: amend spec/rules.jsonl + formal/*.tla + spec/conformance.jsonl FIRST, then implement in each language package. Triggers: 'amend the spec', 'change the protocol', 'add a tier', 'spec change', 'new wave rule', 'this changes protocol behavior'. Not for purely package-local sugar/operator/inspection changes that preserve protocol behavior."
argument-hint: "[short description of the protocol behavior to change]"
---

Read and follow [the maintained spec-amend workflow](../../../.agents/skills/spec-amend/SKILL.md).
Resolve that path relative to this file and pass the user request and arguments through unchanged.
This entrypoint has no separate protocol, decision, work, or review policy.

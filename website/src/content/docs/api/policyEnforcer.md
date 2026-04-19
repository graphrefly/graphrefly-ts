---
title: "policyEnforcer()"
description: "Wraps a Graph with reactive policy enforcement. Pass either a\nstatic rule list or a Node of rules (LLM-updatable). Records\n`PolicyViolation` entries to `violati"
---

Wraps a Graph with reactive policy enforcement. Pass either a
static rule list or a Node of rules (LLM-updatable). Records
`PolicyViolation` entries to `violations` topic; in `"enforce"` mode also
pushes guards onto target nodes so disallowed writes throw.

## Signature

```ts
function policyEnforcer(
	target: Graph,
	policies: readonly PolicyRuleData[] | Node<readonly PolicyRuleData[]>,
	opts: PolicyEnforcerOptions = {},
): PolicyEnforcerGraph
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `Graph` |  |
| `policies` | `readonly PolicyRuleData[] | Node&lt;readonly PolicyRuleData[]&gt;` |  |
| `opts` | `PolicyEnforcerOptions` |  |

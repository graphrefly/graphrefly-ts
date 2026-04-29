---
title: "policyGate()"
description: "Wraps a Graph with reactive policy enforcement. Pass either a\nstatic rule list or a Node of rules (LLM-updatable). Records\n`PolicyViolation` entries to `violati"
---

Wraps a Graph with reactive policy enforcement. Pass either a
static rule list or a Node of rules (LLM-updatable). Records
`PolicyViolation` entries to `violations` topic; in `"enforce"` mode also
pushes guards onto target nodes so disallowed writes throw.

Self-tags via `g.tagFactory("policyGate", placeholderArgs(opts))` so
`graph.describe()` surfaces `factory: "policyGate"` provenance (Phase 2.5
DT5 ride-along, locked with the Tier 2.3 rename).

## Signature

```ts
function policyGate(
	target: Graph,
	policies: readonly PolicyRuleData[] | Node<readonly PolicyRuleData[]>,
	opts: PolicyGateOptions = {},
): PolicyGateGraph
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `Graph` |  |
| `policies` | `readonly PolicyRuleData[] | Node&lt;readonly PolicyRuleData[]&gt;` |  |
| `opts` | `PolicyGateOptions` |  |

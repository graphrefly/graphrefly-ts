---
title: "specDiff()"
description: "Compute a structural diff between two GraphSpecs.\n\nTemplate-aware: reports \"changed template definition\" vs \"changed\ninstantiation bindings.\" No runtime needed "
---

Compute a structural diff between two GraphSpecs.

Template-aware: reports "changed template definition" vs "changed
instantiation bindings." No runtime needed — pure JSON comparison.

## Signature

```ts
function specDiff(specA: GraphSpec, specB: GraphSpec): SpecDiffResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>specA</code> | <code>GraphSpec</code> | The "before" spec. |
| <code>specB</code> | <code>GraphSpec</code> | The "after" spec. |

## Returns

Diff entries and a human-readable summary.

---
title: "budgetGate()"
description: "Pass-through that respects reactive constraint nodes.\n\nDATA flows through when all constraints are satisfied. When any constraint\nis exceeded, PAUSE is sent ups"
---

Pass-through that respects reactive constraint nodes.

DATA flows through when all constraints are satisfied. When any constraint
is exceeded, PAUSE is sent upstream and DATA is buffered. When constraints
relax, RESUME is sent and buffered DATA flushes.

## Signature

```ts
function budgetGate<T>(
	source: Node<T>,
	constraints: ReadonlyArray<BudgetConstraint>,
	opts?: BudgetGateOptions,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Input node. |
| `constraints` | `ReadonlyArray&lt;BudgetConstraint&gt;` | Reactive constraint checks. |
| `opts` | `BudgetGateOptions` | Optional node options. |

## Returns

Gated node.

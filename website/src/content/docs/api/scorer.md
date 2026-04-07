---
title: "scorer()"
description: "Reactive multi-signal scoring with live weights.\n\nEach source emits items to score. Weights are reactive state nodes that\nLLM or human can adjust live. Output i"
---

Reactive multi-signal scoring with live weights.

Each source emits items to score. Weights are reactive state nodes that
LLM or human can adjust live. Output is sorted scored items with full
breakdown.

## Signature

```ts
function scorer(
	sources: ReadonlyArray<Node<number>>,
	weights: ReadonlyArray<Node<number>>,
	opts?: ScorerOptions,
): Node<ScoredItem<number[]>>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `ReadonlyArray&lt;Node&lt;number&gt;&gt;` | Signal nodes (each emits a numeric score dimension). |
| `weights` | `ReadonlyArray&lt;Node&lt;number&gt;&gt;` | Reactive weight nodes (one per source). |
| `opts` | `ScorerOptions` | Optional node/meta options. |

## Returns

Node emitting scored output.

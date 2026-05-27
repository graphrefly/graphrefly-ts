---
title: "funnel()"
description: "Multi-source merge with sequential reduction stages.\n\nSources are merged into a single stream. Each stage is a named subgraph\n(mounted via `graph.mount()`). Sta"
---

Multi-source merge with sequential reduction stages.

Sources are merged into a single stream. Each stage is a named subgraph
(mounted via `graph.mount()`). Stages connect linearly:
`merged → stage[0].input → stage[0].output → stage[1].input → ...`

## Signature

```ts
function funnel<T>(
	name: string,
	sources: ReadonlyArray<Node<T>>,
	stages: ReadonlyArray<FunnelStage>,
	opts?: FunnelOptions,
): Graph
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>name</code> | <code>string</code> | Graph name. |
| <code>sources</code> | <code>ReadonlyArray&lt;Node&lt;T&gt;&gt;</code> | Input nodes to merge. |
| <code>stages</code> | <code>ReadonlyArray&lt;FunnelStage&gt;</code> | Sequential reduction stages. |
| <code>opts</code> | <code>FunnelOptions</code> | Optional graph/meta options. |

## Returns

Graph with `"merged"` and mounted stage subgraphs.

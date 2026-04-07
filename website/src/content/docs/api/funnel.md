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
| `name` | `string` | Graph name. |
| `sources` | `ReadonlyArray&lt;Node&lt;T&gt;&gt;` | Input nodes to merge. |
| `stages` | `ReadonlyArray&lt;FunnelStage&gt;` | Sequential reduction stages. |
| `opts` | `FunnelOptions` | Optional graph/meta options. |

## Returns

Graph with `"merged"` and mounted stage subgraphs.

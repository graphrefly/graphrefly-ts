---
title: "watchTopologyTree()"
description: "Subscribe to structural changes across `graph` and every transitively\nmounted subgraph. `cb` fires on every TopologyEvent from any\ngraph in the tree. Newly-moun"
---

Subscribe to structural changes across `graph` and every transitively
mounted subgraph. `cb` fires on every TopologyEvent from any
graph in the tree. Newly-mounted subgraphs are auto-wired when their
parent emits `{kind: "added", nodeKind: "mount"}`; newly-unmounted
subgraphs' subscriptions are disposed via the parent's
`{kind: "removed", nodeKind: "mount"}` event plus the returned
`GraphRemoveAudit`.

The callback receives a third argument `prefix`: the `::`-delimited
path from the root watched graph to the emitter, ending with `"::"`
(empty string when the event comes from the root itself). Compute
a qualified path for an added/removed entry as `prefix + event.name`.

## Signature

```ts
function watchTopologyTree(
	graph: Graph,
	cb: (event: TopologyEvent, emitter: Graph, prefix: string) => void,
): () => void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>graph</code> | <code>Graph</code> | Root graph to watch. |
| <code>cb</code> | <code>(event: TopologyEvent, emitter: Graph, prefix: string) =&gt; void</code> | Receives `(event, emitterGraph, prefix)`. |

## Returns

Dispose function — tears down every active subscription.

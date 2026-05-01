---
title: "resilientPipeline()"
description: "Compose a resilient pipeline around `source` in the canonical nesting\norder — `rateLimit → budget → breaker → timeout → retry → fallback → status`.\nOmit any opt"
---

Compose a resilient pipeline around `source` in the canonical nesting
order — `rateLimit → budget → breaker → timeout → retry → fallback → status`.
Omit any option to skip that layer.

Returns a ResilientPipelineGraph (Graph subclass) —
`pipeline.output` is the externally visible final node; `pipeline.status`
/ `pipeline.lastError` / `pipeline.breakerState` / `pipeline.droppedCount`
are the per-layer companions. Call `pipeline.describe()` to see the
mounted intermediates; compose with graphLens's `health` for
aggregate status.

**Naming note:** `output` and `lastError` (not `node` / `error`) avoid
clashes with `Graph.node(name)` and `Graph.error(name, err)` on the base
class.

## Signature

```ts
function resilientPipeline<T>(
	source: Node<T>,
	opts: ResilientPipelineOptions<T> = {},
): ResilientPipelineGraph<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node to wrap. |
| `opts` | `ResilientPipelineOptions&lt;T&gt;` | See ResilientPipelineOptions. All fields optional. |

## Basic Usage

```ts
const safeFetch = resilientPipeline(fetchNode, {
    rateLimit: { maxEvents: 10, windowNs: NS_PER_SEC },
    breaker: { failureThreshold: 5 },
    retry: { count: 3, backoff: "exponential" },
    timeoutMs: 10_000,
    fallback: null,
  });
safeFetch.output.subscribe(msgs => console.log(msgs));
safeFetch.status.subscribe(msgs => console.log(msgs));
graphSpecToAscii(safeFetch.describe()); // visualize the chain
```

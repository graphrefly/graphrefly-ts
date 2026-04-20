---
title: "resilientPipeline()"
description: "Compose a resilient pipeline around `source` in the canonical nesting\norder — `rateLimit → budget → breaker → timeout → retry → fallback → status`.\nOmit any opt"
---

Compose a resilient pipeline around `source` in the canonical nesting
order — `rateLimit → budget → breaker → timeout → retry → fallback → status`.
Omit any option to skip that layer.

## Signature

```ts
function resilientPipeline<T>(
	source: Node<T>,
	opts: ResilientPipelineOptions<T> = {},
): ResilientPipelineBundle<T>
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
safeFetch.status.subscribe(msgs => console.log(msgs));
```

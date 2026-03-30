---
title: "rateLimiter()"
description: "Enforces a sliding window: at most `maxEvents` `DATA` values per `windowNs`."
---

Enforces a sliding window: at most `maxEvents` `DATA` values per `windowNs`.

## Signature

```ts
function rateLimiter<T>(source: Node<T>, maxEvents: number, windowNs: number): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `maxEvents` | `number` | Maximum `DATA` emissions per window (must be positive). |
| `windowNs` | `number` | Window length in nanoseconds (must be positive). |

## Returns

Node that queues excess values FIFO until a slot frees.

## Behavior Details

- **Terminal:** `COMPLETE` / `ERROR` cancel timers, drop pending queue, and clear window state.

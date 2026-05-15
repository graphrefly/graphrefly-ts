---
title: "rateLimiter()"
description: "Token-bucket rate limiter: at most `maxEvents` `DATA` values per `windowNs`.\n\nUses tokenBucket internally (capacity = `maxEvents`, refill = `maxEvents / windowS"
---

Token-bucket rate limiter: at most `maxEvents` `DATA` values per `windowNs`.

Uses tokenBucket internally (capacity = `maxEvents`, refill = `maxEvents / windowSeconds`).
Excess items are queued FIFO (in a fixed-capacity RingBuffer for O(1) push/shift)
until a token is available. The queue is bounded by the **required** `maxBuffer` option
with a configurable overflow policy.

## Signature

```ts
function rateLimiter<T>(
	source: Node<T>,
	opts: NodeOrValue<RateLimiterOptions>,
): RateLimiterBundle<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `opts` | `NodeOrValue&lt;RateLimiterOptions&gt;` | Rate + bounded-buffer configuration. `maxBuffer` is required (use `Infinity` to opt in to unbounded). |

## Returns

`{ node, droppedCount }` bundle. Subscribe to `node` for the throttled stream and to `droppedCount` for backpressure pressure.

## Basic Usage

```ts
import { rateLimiter, state, NS_PER_SEC } from "@graphrefly/graphrefly-ts";

const src = state(0);
// Allow at most 5 DATA values per second; queue up to 100 excess items, drop newest beyond.
const { node: limited, droppedCount } = rateLimiter(src, {
    maxEvents: 5,
    windowNs: NS_PER_SEC,
    maxBuffer: 100,
  });
droppedCount.subscribe(([m]) => console.log("dropped so far:", m[1]));
```

## Behavior Details

- **Terminal:** `COMPLETE` / `ERROR` cancel the refill timer, drop the pending queue,
reset `droppedCount` to `0`, and propagate.

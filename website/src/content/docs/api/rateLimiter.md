---
title: "rateLimiter()"
description: "Token-bucket rate limiter: at most `maxEvents` `DATA` values per `windowNs`.\n\nUses tokenBucket internally (capacity = `maxEvents`, refill = `maxEvents / windowS"
---

Token-bucket rate limiter: at most `maxEvents` `DATA` values per `windowNs`.

Uses tokenBucket internally (capacity = `maxEvents`, refill = `maxEvents / windowSeconds`).
Excess items are queued FIFO until a token is available. The queue may be bounded via
`maxBuffer` with a configurable overflow policy.

## Signature

```ts
function rateLimiter<T>(source: Node<T>, opts: RateLimiterOptions): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `opts` | `RateLimiterOptions` | Rate + optional bounded-buffer configuration. |

## Returns

Node that emits DATA at most `maxEvents` per `windowNs`.

## Basic Usage

```ts
import { rateLimiter, state, NS_PER_SEC } from "@graphrefly/graphrefly-ts";

const src = state(0);
// Allow at most 5 DATA values per second; queue up to 100 excess items, drop newest beyond.
const limited = rateLimiter(src, { maxEvents: 5, windowNs: NS_PER_SEC, maxBuffer: 100 });
```

## Behavior Details

- **Terminal:** `COMPLETE` / `ERROR` cancel the refill timer, drop the pending queue, and propagate.

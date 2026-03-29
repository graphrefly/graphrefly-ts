---
title: "withBreaker()"
description: "Returns a unary wrapper that gates upstream `DATA` through a ."
---

Returns a unary wrapper that gates upstream `DATA` through a .

## Signature

```ts
function withBreaker<T>(
	breaker: CircuitBreaker,
	options?: { onOpen?: "skip" | "error" },
): (source: Node<T>) => WithBreakerBundle<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `breaker` | `CircuitBreaker` | Shared breaker instance (typically one per resource). |
| `options` | `{ onOpen?: "skip" | "error" }` | `onOpen: "skip"` emits `RESOLVED` when open; `"error"` emits . |

## Returns

Function mapping `Node&lt;T&gt;` to `{ node, breakerState }` companion nodes.

## Basic Usage

```ts
import { state, withBreaker, circuitBreaker } from "@graphrefly/graphrefly-ts";

const b = circuitBreaker({ failureThreshold: 2 });
const s = state(1);
const { node, breakerState } = withBreaker(b)(s);
```

## Behavior Details

- **Success path:** `COMPLETE` calls . **Failure path:** upstream `ERROR` calls  and is forwarded.

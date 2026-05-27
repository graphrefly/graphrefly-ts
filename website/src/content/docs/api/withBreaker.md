---
title: "withBreaker()"
description: "Returns a unary wrapper that gates upstream `DATA` through a CircuitBreaker."
---

Returns a unary wrapper that gates upstream `DATA` through a CircuitBreaker.

## Signature

```ts
function withBreaker<T>(
	breaker: CircuitBreaker,
	options?: { onOpen?: "skip" | "error"; meta?: Record<string, unknown> },
): (source: Node<T>) => WithBreakerBundle<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>breaker</code> | <code>CircuitBreaker</code> | Shared breaker instance (typically one per resource). |
| <code>options</code> | <code>{ onOpen?: "skip" | "error"; meta?: Record&lt;string, unknown&gt; }</code> | `onOpen: "skip"` emits `RESOLVED` when open; `"error"` emits CircuitOpenError. |

## Returns

Function mapping `Node&lt;T&gt;` to `{ node, breakerState }` companion nodes.

## Basic Usage

```ts
import { state, withBreaker, circuitBreaker } from "@graphrefly/graphrefly";

const b = circuitBreaker({ failureThreshold: 2 });
const s = state(1);
const { node, breakerState } = withBreaker(b)(s);
```

## Behavior Details

- **Success path:** `COMPLETE` calls CircuitBreaker.recordSuccess. **Failure path:** upstream `ERROR` calls CircuitBreaker.recordFailure and is forwarded.

**State telemetry:** `breakerState: Node<CircuitState>` is a reactive companion that mirrors `breaker.state` — every transition (`closed`/`open`/`half-open`) emits a `DATA`. Also accessible via `node.meta.breakerState` for `describe()` traversal.

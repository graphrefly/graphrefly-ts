---
title: "withStatus()"
description: "Wraps `src` with `status` and `error` state companions for UI or meta snapshots."
---

Wraps `src` with `status` and `error` state companions for UI or meta snapshots.

## Signature

```ts
function withStatus<T>(
	src: Node<T>,
	options?: { initialStatus?: StatusValue },
): WithStatusBundle<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `src` | `Node&lt;T&gt;` | Upstream node to mirror. |
| `options` | `{ initialStatus?: StatusValue }` | `initialStatus` defaults to `"pending"`. |

## Returns

`{ node, status, error }` where `error` holds the last `ERROR` payload.

## Behavior Details

- **Recovery:** After `errored`, the next `DATA` clears `error` and sets `active` inside batch (matches graphrefly-py).

---
title: "observeGraph$()"
description: "Observe all nodes in a `Graph` as an `Observable<{ path, messages }>`.\n\nEach emission carries the qualified node path and the raw message batch.\nThe Observable "
---

Observe all nodes in a `Graph` as an `Observable&lt;{ path, messages }&gt;`.

Each emission carries the qualified node path and the raw message batch.
The Observable never self-completes (graphs are long-lived); dispose by
unsubscribing.

## Signature

```ts
function observeGraph$(
	graph: Graph,
	options?: ObserveOptions,
): Observable<{ path: string; messages: Messages }>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` |  |
| `options` | `ObserveOptions` |  |

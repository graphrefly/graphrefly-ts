---
title: "takeUntil()"
description: "Emit values from `source` until `notifier` delivers a matching message, then `COMPLETE`.\nBy default triggers on `DATA` from the notifier. Pass `predicate` for c"
---

Emit values from `source` until `notifier` delivers a matching message, then `COMPLETE`.
By default triggers on `DATA` from the notifier. Pass `predicate` for custom trigger logic.

## Signature

```ts
function takeUntil<T>(
	source: Node<T>,
	notifier: Node,
	opts?: ExtraOpts & { predicate?: (msg: Message) => boolean },
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` |  |
| `notifier` | `Node` |  |
| `opts` | `ExtraOpts & { predicate?: (msg: Message) =&gt; boolean }` |  |

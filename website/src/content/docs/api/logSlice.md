---
title: "logSlice()"
description: "Builds a derived node for `entries.slice(start, stop)` (same semantics as `Array.prototype.slice`; `stop` exclusive)."
---

Builds a derived node for `entries.slice(start, stop)` (same semantics as `Array.prototype.slice`; `stop` exclusive).

## Signature

```ts
function logSlice<T>(
	log: ReactiveLogBundle<T>,
	start: number,
	stop?: number,
): Node<readonly T[]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `log` | `ReactiveLogBundle&lt;T&gt;` | Log from reactiveLog. |
| `start` | `number` | Start index (must be `&gt;= 0`). |
| `stop` | `number` | End index (exclusive); omit to slice to the end. |

## Returns

Derived node emitting the sliced readonly array.

---
title: "zip()"
description: "Zip one value from each source per cycle into a tuple. Only `DATA` enqueues values\n(RESOLVED does not per spec §1.3.3). Completes when a completed source's buff"
---

Zip one value from each source per cycle into a tuple. Only `DATA` enqueues values
(RESOLVED does not per spec §1.3.3). Completes when a completed source's buffer is empty.

## Signature

```ts
function zip<const T extends readonly unknown[]>(
	sources: { [K in keyof T]: Node<T[K]> },
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `{ [K in keyof T]: Node&lt;T[K]&gt; }` |  |
| `opts` | `ExtraOpts` |  |

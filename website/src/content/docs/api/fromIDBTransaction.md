---
title: "fromIDBTransaction()"
description: "Wraps an `IDBTransaction` terminal lifecycle as a one-shot reactive source."
---

Wraps an `IDBTransaction` terminal lifecycle as a one-shot reactive source.

## Signature

```ts
function fromIDBTransaction(tx: IDBTransaction): Node<void>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `tx` | `IDBTransaction` | Transaction to observe. |

## Returns

`Node&lt;void&gt;` that emits `DATA` (`undefined`) then `COMPLETE` on success; emits `ERROR` on `error`/`abort`.

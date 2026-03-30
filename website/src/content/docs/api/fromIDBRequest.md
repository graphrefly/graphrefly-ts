---
title: "fromIDBRequest()"
description: "Wraps an `IDBRequest` as a one-shot reactive source."
---

Wraps an `IDBRequest` as a one-shot reactive source.

## Signature

```ts
function fromIDBRequest<T>(req: IDBRequest<T>): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `req` | `IDBRequest&lt;T&gt;` | Request whose callbacks are converted to protocol messages. |

## Returns

`Node&lt;T&gt;` that emits `DATA` once on success, then `COMPLETE`; emits `ERROR` on failure.

## Basic Usage

```ts
import { fromIDBRequest } from "@graphrefly/graphrefly-ts";

const req = indexedDB.open("myDb", 1);
fromIDBRequest(req).subscribe((msgs) => console.log(msgs));
// Emits [[DATA, IDBDatabase], [COMPLETE]] on success
```

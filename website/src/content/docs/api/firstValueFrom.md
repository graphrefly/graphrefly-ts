---
title: "firstValueFrom()"
description: "Converts the first `DATA` on `source` into a Promise; rejects on `ERROR` or `COMPLETE` without data.\n\n**Important:** This subscribes and waits for a **future** "
---

Converts the first `DATA` on `source` into a Promise; rejects on `ERROR` or `COMPLETE` without data.

**Important:** This subscribes and waits for a **future** emission. Data that
has already flowed is gone and will not be seen. Call this *before* the upstream
emits, or use `source.cache` / `source.status` for already-cached state.
See COMPOSITION-GUIDE §2 (subscription ordering).

## Signature

```ts
function firstValueFrom<T>(source: Node<T>): Promise<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>source</code> | <code>Node&lt;T&gt;</code> | Node to read once. |

## Returns

Promise of the first value.

## Basic Usage

```ts
import { firstValueFrom, of } from "@graphrefly/graphrefly";

await firstValueFrom(of(42));
```

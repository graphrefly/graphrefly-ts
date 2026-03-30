---
title: "firstValueFrom()"
description: "Converts the first `DATA` on `source` into a Promise; rejects on `ERROR` or `COMPLETE` without data."
---

Converts the first `DATA` on `source` into a Promise; rejects on `ERROR` or `COMPLETE` without data.

## Signature

```ts
function firstValueFrom<T>(source: Node<T>): Promise<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Node to read once. |

## Returns

Promise of the first value.

## Basic Usage

```ts
import { firstValueFrom, of } from "@graphrefly/graphrefly-ts";

await firstValueFrom(of(42));
```

---
title: "fromIter()"
description: "Drains a synchronous iterable; each item is `DATA`, then `COMPLETE`, or `ERROR` if iteration throws."
---

Drains a synchronous iterable; each item is `DATA`, then `COMPLETE`, or `ERROR` if iteration throws.

## Signature

```ts
function fromIter<T>(iterable: Iterable<T>, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `iterable` | `Iterable&lt;T&gt;` | Values to emit in order. |
| `opts` | `ExtraOpts` | Optional producer options. |

## Returns

`Node&lt;T&gt;` — one emission per element.

## Basic Usage

```ts
import { fromIter } from "@graphrefly/graphrefly-ts";

fromIter([1, 2, 3]);
```

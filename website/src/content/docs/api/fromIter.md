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
| <code>iterable</code> | <code>Iterable&lt;T&gt;</code> | Values to emit in order. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional producer options. |

## Returns

`Node&lt;T&gt;` — one emission per element.

## Basic Usage

```ts
import { fromIter } from "@graphrefly/pure-ts";

fromIter([1, 2, 3]);
```

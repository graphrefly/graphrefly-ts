---
title: "fromPromise()"
description: "Lifts a Promise (or thenable) to a single-value stream: one `DATA` then `COMPLETE`, or `ERROR` on rejection."
---

Lifts a Promise (or thenable) to a single-value stream: one `DATA` then `COMPLETE`, or `ERROR` on rejection.

## Signature

```ts
function fromPromise<T>(p: Promise<T> | PromiseLike<T>, opts?: AsyncSourceOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `p` | `Promise&lt;T&gt; | PromiseLike&lt;T&gt;` | Promise to await. |
| `opts` | `AsyncSourceOpts` | Producer options plus optional `signal` for abort → `ERROR` with reason. |

## Returns

`Node&lt;T&gt;` — settles once.

## Basic Usage

```ts
import { fromPromise } from "@graphrefly/graphrefly-ts";

fromPromise(Promise.resolve(42));
```

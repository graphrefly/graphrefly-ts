---
title: "fromAny()"
description: "Coerces a value to a `Node` by shape: existing `Node` passthrough, thenable → fromPromise,\nasync iterable → fromAsyncIter, sync iterable → fromIter, else scalar"
---

Coerces a value to a `Node` by shape: existing `Node` passthrough, thenable → fromPromise,
async iterable → fromAsyncIter, sync iterable → fromIter, else scalar → of.

## Signature

```ts
function fromAny<T>(input: NodeInput<T>, opts?: AsyncSourceOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `NodeInput&lt;T&gt;` | Any value to wrap. |
| `opts` | `AsyncSourceOpts` | Passed through when a Promise/async path is chosen. |

## Returns

`Node` of the inferred element type.

## Basic Usage

```ts
import { fromAny, state } from "@graphrefly/graphrefly-ts";

fromAny(state(1));
fromAny(Promise.resolve(2));
```

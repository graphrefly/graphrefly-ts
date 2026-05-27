---
title: "fromPromise()"
description: "Lifts a Promise (or thenable) to a single-value stream: one `DATA` then\n`COMPLETE`, or `ERROR` on rejection."
---

Lifts a Promise (or thenable) to a single-value stream: one `DATA` then
`COMPLETE`, or `ERROR` on rejection.

## Signature

```ts
function fromPromise<T>(p: Promise<T> | PromiseLike<T>, opts?: AsyncSourceOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>p</code> | <code>Promise&lt;T&gt; | PromiseLike&lt;T&gt;</code> | Promise to await. |
| <code>opts</code> | <code>AsyncSourceOpts</code> | Producer options plus optional `signal` for abort → `ERROR`. |

## Returns

`Node&lt;T&gt;` — settles once.

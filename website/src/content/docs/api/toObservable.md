---
title: "toObservable()"
description: "Bridge a `Node<T>` to an RxJS `Observable<T>`.\n\nEmits the node's value on each `DATA` message. Maps `ERROR` to\n`subscriber.error()` and `COMPLETE` to `subscribe"
---

Bridge a `Node&lt;T&gt;` to an RxJS `Observable&lt;T&gt;`.

Emits the node's value on each `DATA` message. Maps `ERROR` to
`subscriber.error()` and `COMPLETE` to `subscriber.complete()`.
Protocol-internal signals (DIRTY, RESOLVED, PAUSE, etc.) are skipped.

Unsubscribing the Observable unsubscribes the node.

## Signature

```ts
function toObservable<T>(node: Node<T>): Observable<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `node` | `Node&lt;T&gt;` |  |

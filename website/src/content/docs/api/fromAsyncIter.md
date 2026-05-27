---
title: "fromAsyncIter()"
description: "Reads an async iterable; each `next()` value becomes `DATA`; `COMPLETE`\nwhen done; `ERROR` on failure."
---

Reads an async iterable; each `next()` value becomes `DATA`; `COMPLETE`
when done; `ERROR` on failure.

## Signature

```ts
function fromAsyncIter<T>(iterable: AsyncIterable<T>, opts?: AsyncSourceOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>iterable</code> | <code>AsyncIterable&lt;T&gt;</code> | Async source (`for await` shape). |
| <code>opts</code> | <code>AsyncSourceOpts</code> | Producer options plus optional `signal` to abort the pump. |

## Returns

`Node&lt;T&gt;` — async pull stream.

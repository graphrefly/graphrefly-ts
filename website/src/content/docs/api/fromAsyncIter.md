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
| `iterable` | `AsyncIterable&lt;T&gt;` | Async source (`for await` shape). |
| `opts` | `AsyncSourceOpts` | Producer options plus optional `signal` to abort the pump. |

## Returns

`Node&lt;T&gt;` — async pull stream.

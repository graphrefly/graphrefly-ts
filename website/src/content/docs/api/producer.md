---
title: "producer()"
description: "Creates a producer node with no deps; `fn` runs once when the first\nsubscriber connects. Return a cleanup function (`() => void` — fires on\nevery transition) or"
---

Creates a producer node with no deps; `fn` runs once when the first
subscriber connects. Return a cleanup function (`() =&gt; void` — fires on
every transition) or an object with granular hooks
(`{ beforeRun?, deactivate?, invalidate? }` — each hook fires on its named
transition only) to register teardown. See NodeFnCleanup.

## Signature

```ts
function producer<T = unknown>(fn: ProducerFn, opts?: NodeOptions<T>): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `ProducerFn` |  |
| `opts` | `NodeOptions&lt;T&gt;` |  |

## Basic Usage

```ts
const ticker = producer((actions) => {
    const id = setInterval(() => actions.emit(Date.now()), 1000);
    return () => clearInterval(id);
  });
```

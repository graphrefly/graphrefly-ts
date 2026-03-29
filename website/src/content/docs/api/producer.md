---
title: "producer()"
description: "Auto source: no deps; `fn` runs on subscribe and uses `actions.emit` / `actions.down`."
---

Auto source: no deps; `fn` runs on subscribe and uses `actions.emit` / `actions.down`.

## Signature

```ts
function producer<T = unknown>(fn: NodeFn<T>, opts?: NodeOptions): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `NodeFn&lt;T&gt;` |  |
| `opts` | `NodeOptions` |  |

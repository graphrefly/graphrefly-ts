---
title: "skip()"
description: "Skip the first `count` **`DATA`** emissions from `source`. `RESOLVED` settlements do not\nadvance the counter."
---

Skip the first `count` **`DATA`** emissions from `source`. `RESOLVED` settlements do not
advance the counter.

## Signature

```ts
function skip<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` |  |
| `count` | `number` |  |
| `opts` | `ExtraOpts` |  |

---
title: "map()"
description: "Map each value from `source` through `project`."
---

Map each value from `source` through `project`.

## Signature

```ts
function map<T, R>(source: Node<T>, project: (value: T) => R, opts?: ExtraOpts): Node<R>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` |  |
| `project` | `(value: T) =&gt; R` |  |
| `opts` | `ExtraOpts` |  |

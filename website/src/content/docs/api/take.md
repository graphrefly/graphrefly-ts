---
title: "take()"
description: "Emit at most `count` **`DATA`** values from `source`, then `COMPLETE`. `RESOLVED` settlements\nfrom upstream do not advance the counter (so `skip` + `take` compo"
---

Emit at most `count` **`DATA`** values from `source`, then `COMPLETE`. `RESOLVED` settlements
from upstream do not advance the counter (so `skip` + `take` composes correctly).

## Signature

```ts
function take<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` |  |
| `count` | `number` |  |
| `opts` | `ExtraOpts` |  |

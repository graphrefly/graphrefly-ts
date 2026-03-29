---
title: "race()"
description: "Race: first source to emit `DATA` wins. All subsequent messages are forwarded only from\nthe winning source; other sources are silenced. Matches Rx `race` semant"
---

Race: first source to emit `DATA` wins. All subsequent messages are forwarded only from
the winning source; other sources are silenced. Matches Rx `race` semantics.

## Signature

```ts
function race<T>(sources: readonly Node<T>[], opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `readonly Node&lt;T&gt;[]` |  |
| `opts` | `ExtraOpts` |  |

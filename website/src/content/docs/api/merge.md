---
title: "merge()"
description: "Merge: forward DATA from any dependency. Uses dirty bitmask for proper two-phase tracking.\n**`COMPLETE`** is emitted only after **every** source has completed ("
---

Merge: forward DATA from any dependency. Uses dirty bitmask for proper two-phase tracking.
**`COMPLETE`** is emitted only after **every** source has completed (spec §1.3.5).

## Signature

```ts
function merge<T>(sources: readonly Node<T>[], opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `readonly Node&lt;T&gt;[]` |  |
| `opts` | `ExtraOpts` |  |

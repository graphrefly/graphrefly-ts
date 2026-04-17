---
title: "state()"
description: "Creates a manual source node. Drive it with `state.emit(v)` (framed,\ndiamond-safe) or `state.down([[DATA, v]])` (raw compat path)."
---

Creates a manual source node. Drive it with `state.emit(v)` (framed,
diamond-safe) or `state.down([[DATA, v]])` (raw compat path).

## Signature

```ts
function state<T>(initial: T, opts?: Omit<NodeOptions<T>, "initial">): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `initial` | `T` | Starting cached value. Pass `undefined` or `null`
explicitly to cache that value; omit to leave the node in `"sentinel"`. |
| `opts` | `Omit&lt;NodeOptions&lt;T&gt;, "initial"&gt;` | Optional NodeOptions (excluding `initial`). |

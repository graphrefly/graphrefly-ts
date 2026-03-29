---
title: "state()"
description: "Manual source: no deps, no compute fn. Emit via .\nSpec: `state(initial, opts?)` ≡ `node([], { initial, ...opts })` (same as `node([], null, { … })` in §2.7)."
---

Manual source: no deps, no compute fn. Emit via .
Spec: `state(initial, opts?)` ≡ `node([], { initial, ...opts })` (same as `node([], null, { … })` in §2.7).

## Signature

```ts
function state<T>(initial: T, opts?: Omit<NodeOptions, "initial">): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `initial` | `T` |  |
| `opts` | `Omit&lt;NodeOptions, "initial"&gt;` |  |

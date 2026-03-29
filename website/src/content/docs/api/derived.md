---
title: "derived()"
description: "Reactive compute: deps + fn that returns a value (or uses explicit `down()` / `emit()`).\nThin alias over ; same primitive as “operator” style in the spec."
---

Reactive compute: deps + fn that returns a value (or uses explicit `down()` / `emit()`).
Thin alias over ; same primitive as “operator” style in the spec.

## Signature

```ts
function derived<T = unknown>(
	deps: readonly Node[],
	fn: NodeFn<T>,
	opts?: NodeOptions,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `readonly Node[]` |  |
| `fn` | `NodeFn&lt;T&gt;` |  |
| `opts` | `NodeOptions` |  |

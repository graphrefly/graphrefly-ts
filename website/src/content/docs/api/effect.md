---
title: "effect()"
description: "Runs a side-effect when deps settle. Return value is not auto-emitted."
---

Runs a side-effect when deps settle. Return value is not auto-emitted.

## Signature

```ts
function effect(
	deps: readonly Node[],
	fn: EffectFn,
	opts?: NodeOptions<unknown>,
): Node<unknown>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `readonly Node[]` |  |
| `fn` | `EffectFn` |  |
| `opts` | `NodeOptions&lt;unknown&gt;` |  |

## Basic Usage

```ts
effect([source], ([v]) => {
    console.log(v);
  });
```

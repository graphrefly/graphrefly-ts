---
title: "effectT()"
description: "Typed-tuple variant of effect. Use when the dep types matter at\nthe callback boundary — `data` is inferred as a tuple of dep value types\ninstead of `readonly un"
---

Typed-tuple variant of effect. Use when the dep types matter at
the callback boundary — `data` is inferred as a tuple of dep value types
instead of `readonly unknown[]`.

Same runtime semantics as effect (first-run gate, no auto-emit,
cleanup contract).

**`partial: true` is rejected at the type level (qa F-E, 2026-04-29).**
See derivedT for the soundness rationale.

## Signature

```ts
function effectT<TDeps extends readonly Node<unknown>[]>(
	deps: TDeps,
	fn: EffectTFn<TDeps>,
	opts?: Omit<NodeOptions<unknown>, "partial"> & { partial?: false },
): Node<unknown>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `TDeps` |  |
| `fn` | `EffectTFn&lt;TDeps&gt;` |  |
| `opts` | `Omit&lt;NodeOptions&lt;unknown&gt;, "partial"&gt; & { partial?: false }` |  |

## Basic Usage

```ts
const user = state<User | null>(null);
const cfg = state<Config>(defaultCfg);
effectT([user, cfg], ([u, c]) => {
    if (u != null) hydrate(u, c);
  });
```

---
title: "derivedT()"
description: "Typed-tuple variant of derived. Use when the dep types matter at\nthe callback boundary — `data` is inferred as a tuple of dep value types\ninstead of `readonly u"
---

Typed-tuple variant of derived. Use when the dep types matter at
the callback boundary — `data` is inferred as a tuple of dep value types
instead of `readonly unknown[]`.

Same runtime semantics as derived (first-run gate, snapshot
combine semantics, equals substitution).

**`partial: true` is rejected at the type level (qa F-E, 2026-04-29).**
Tuple slots in `NodeValues&lt;TDeps&gt;` resolve to `V` (never `V | undefined`),
but `partial: true` lets fn run before every dep has fired. The two are
unsound together — fn would receive `undefined` for an unfired dep but
see it typed as `V`. Callers needing partial firing keep using untyped
derived where `data` is `readonly unknown[]` and the
`=== undefined` guard is sanctioned (COMPOSITION-GUIDE §3 partial-true
exception).

## Signature

```ts
function derivedT<TDeps extends readonly Node<unknown>[], TOut>(
	deps: TDeps,
	fn: DerivedTFn<TDeps, TOut>,
	opts?: Omit<NodeOptions<TOut>, "partial"> & { partial?: false },
): Node<TOut>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `TDeps` |  |
| `fn` | `DerivedTFn&lt;TDeps, TOut&gt;` |  |
| `opts` | `Omit&lt;NodeOptions&lt;TOut&gt;, "partial"&gt; & { partial?: false }` |  |

## Basic Usage

```ts
const a = state(1);
const b = state("hi");
// sum: number, label: string — no casts needed.
const out = derivedT([a, b], ([sum, label]) => `${label}:${sum * 2}`);
```

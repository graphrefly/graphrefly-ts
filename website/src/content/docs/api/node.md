---
title: "node()"
description: "Creates a reactive Node — the single GraphReFly primitive (§2).\n\nTypical shapes:\n- `node([])` / `node({ initial: v })` — a manual source (state node).\n- `node(p"
---

Creates a reactive Node — the single GraphReFly primitive (§2).

Typical shapes:
- `node([])` / `node({ initial: v })` — a manual source (state node).
- `node(producerFn, opts)` — a producer that runs on first-subscribe.
- `node(deps, computeFn, opts)` — a derived / effect node.

For value-returning computations, prefer the sugar factories in `sugar.ts`
(`state`, `derived`, `effect`, `producer`, `dynamicNode`), which wrap user
fns with `actions.emit(userFn(data))`. Calling `node()` directly gives you
the raw `NodeFn` contract: explicit emission via `actions`, cleanup return.

## Signature

```ts
function node<T = unknown>(
	depsOrFn?: readonly Node[] | NodeFn | NodeOptions<T>,
	fnOrOpts?: NodeFn | NodeOptions<T>,
	optsArg?: NodeOptions<T>,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `depsOrFn` | `readonly Node[] | NodeFn | NodeOptions&lt;T&gt;` |  |
| `fnOrOpts` | `NodeFn | NodeOptions&lt;T&gt;` |  |
| `optsArg` | `NodeOptions&lt;T&gt;` |  |

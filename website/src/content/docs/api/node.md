---
title: "node()"
description: "Creates a reactive Node — the single GraphReFly primitive (§2).\n\nTypical shapes: `node([])` / `node([], opts)` for a manual source;\n`node(producerFn, opts)` for"
---

Creates a reactive Node — the single GraphReFly primitive (§2).

Typical shapes: `node([])` / `node([], opts)` for a manual source;
`node(producerFn, opts)` for a producer; `node(deps, computeFn, opts)` for
derived nodes and operators.

## Signature

```ts
function node<T = unknown>(
	depsOrFn?: readonly Node[] | NodeFn<T> | NodeOptions,
	fnOrOpts?: NodeFn<T> | NodeOptions,
	optsArg?: NodeOptions,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `depsOrFn` | `readonly Node[] | NodeFn&lt;T&gt; | NodeOptions` | Dependency nodes, a NodeFn (producer), or NodeOptions alone. |
| `fnOrOpts` | `NodeFn&lt;T&gt; | NodeOptions` | With deps: compute function or options. Omitted for producer-only form. |
| `optsArg` | `NodeOptions` | Options when both `deps` and `fn` are provided. |

## Returns

`Node&lt;T&gt;` — lazy until subscribed.

## Basic Usage

```ts
import { node, state } from "@graphrefly/graphrefly-ts";

const a = state(1);
const b = node([a], ([x]) => (x as number) + 1);
```

## Behavior Details

- **Protocol:** START handshake, DIRTY / DATA / RESOLVED ordering, completion,
and batch deferral follow `~/src/graphrefly/GRAPHREFLY-SPEC.md`.

**`equals` and mutable values:** The default `Object.is` identity check is
correct for the common immutable-value case. If your node produces mutable
objects, provide a custom `equals` — otherwise `Object.is` always returns
`true` for the same reference and the node emits `RESOLVED` instead of `DATA`.

**ROM/RAM (§2.2):** State nodes (no fn) preserve their cache across
disconnect — runtime writes survive. Compute nodes (derived, producer)
clear their cache on disconnect; reconnect re-runs fn.

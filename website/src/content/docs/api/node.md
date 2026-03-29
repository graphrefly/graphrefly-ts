---
title: "node()"
description: "Creates a reactive  — the single GraphReFly primitive (GRAPHREFLY-SPEC §2).\n\nTypical shapes: `node([])` / `node([], opts)` for a manual source; `node(producerFn"
---

Creates a reactive  — the single GraphReFly primitive (GRAPHREFLY-SPEC §2).

Typical shapes: `node([])` / `node([], opts)` for a manual source; `node(producerFn, opts)` for a
producer; `node(deps, computeFn, opts)` for derived nodes and operators.

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
| `depsOrFn` | `readonly Node[] | NodeFn&lt;T&gt; | NodeOptions` | Dependency nodes, a  (producer), or  alone. |
| `fnOrOpts` | `NodeFn&lt;T&gt; | NodeOptions` | With deps: compute function or options. Omitted for producer-only form. |
| `optsArg` | `NodeOptions` | Options when both `deps` and `fn` are provided. |

## Returns

`Node&lt;T&gt;` - Configured node instance (lazy until subscribed).

## Basic Usage

```ts
import { node, state } from "@graphrefly/graphrefly-ts";

const a = state(1);
const b = node([a], ([x]) => (x as number) + 1);
```

## Behavior Details

- **Protocol:** DIRTY / DATA / RESOLVED ordering, completion, and batch deferral follow `GRAPHREFLY-SPEC.md`.

## See Also

- [GRAPHREFLY-SPEC.md](/spec)

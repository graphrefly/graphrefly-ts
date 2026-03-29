---
title: "reduce()"
description: "Reduces to one value emitted when `source` completes; if no `DATA` arrived, emits `seed`."
---

Reduces to one value emitted when `source` completes; if no `DATA` arrived, emits `seed`.

## Signature

```ts
function reduce<T, R>(
	source: Node<T>,
	reducer: (acc: R, value: T) => R,
	seed: R,
	opts?: ExtraOpts,
): Node<R>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `reducer` | `(acc: R, value: T) =&gt; R` | `(acc, value) =&gt; nextAcc`. |
| `seed` | `R` | Empty-completion default and initial accumulator. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;R&gt;` - Node that emits once on completion.

## Basic Usage

```ts
import { reduce, state } from "@graphrefly/graphrefly-ts";

const n = reduce(state(1), (a, x) => a + x, 0);
```

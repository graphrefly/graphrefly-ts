---
title: "reduce()"
description: "Reduces to one value emitted when `source` completes; if no `DATA` arrived, emits `seed`.\n\nUnlike RxJS, `seed` is always required. If the source completes witho"
---

Reduces to one value emitted when `source` completes; if no `DATA` arrived, emits `seed`.

Unlike RxJS, `seed` is always required. If the source completes without emitting
DATA, the seed value is emitted (RxJS would throw without a seed).

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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>reducer</code> | <code>(acc: R, value: T) =&gt; R</code> | `(acc, value) =&gt; nextAcc`. |
| <code>seed</code> | <code>R</code> | Empty-completion default and initial accumulator (required). |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;R&gt;` - Node that emits once on completion.

## Basic Usage

```ts
import { reduce, state } from "@graphrefly/pure-ts";

const n = reduce(state(1), (a, x) => a + x, 0);
```

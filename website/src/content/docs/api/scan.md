---
title: "scan()"
description: "Folds each upstream value into an accumulator; emits the new accumulator every time.\n\nUnlike RxJS, `seed` is always required — there is no seedless mode where t"
---

Folds each upstream value into an accumulator; emits the new accumulator every time.

Unlike RxJS, `seed` is always required — there is no seedless mode where the first
value silently becomes the accumulator.

## Signature

```ts
function scan<T, R>(
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
| `seed` | `R` | Initial accumulator (required). |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;R&gt;` - Scan node.

## Basic Usage

```ts
import { scan, state } from "@graphrefly/graphrefly-ts";

const n = scan(state(1), (a, x) => a + x, 0);
```

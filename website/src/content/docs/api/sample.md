---
title: "sample()"
description: "Emits the most recent source value whenever `notifier` settles (`sample`)."
---

Emits the most recent source value whenever `notifier` settles (`sample`).

## Signature

```ts
function sample<T>(source: Node<T>, notifier: Node<unknown>, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Node whose latest value is sampled. |
| `notifier` | `Node&lt;unknown&gt;` | When this node settles (`DATA` / `RESOLVED`), a sample is taken. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Sampled snapshots of `source`.

## Basic Usage

```ts
import { sample, state } from "@graphrefly/graphrefly-ts";

sample(state(1), state(0));
```

## Behavior Details

- **Undefined payload:** If `T` includes `undefined`, `get() === undefined` is treated as “no snapshot” and the operator emits `RESOLVED` instead of `DATA`.

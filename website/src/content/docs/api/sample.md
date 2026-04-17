---
title: "sample()"
description: "Emits the most recent source value whenever `notifier` emits `DATA` (`sample`).\n\nSource `COMPLETE` stops sampling (clears held value); notifier `COMPLETE` termi"
---

Emits the most recent source value whenever `notifier` emits `DATA` (`sample`).

Source `COMPLETE` stops sampling (clears held value); notifier `COMPLETE` terminates the
operator. `ERROR` from either dep terminates immediately. At most one terminal message is
emitted downstream (latch). Supports `resubscribable` — `ctx.store` resets automatically.

## Signature

```ts
function sample<T>(source: Node<T>, notifier: Node<unknown>, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Node whose latest value is sampled. |
| `notifier` | `Node&lt;unknown&gt;` | When this node emits `DATA`, a sample is taken. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Sampled snapshots of `source`.

## Basic Usage

```ts
import { sample, state } from "@graphrefly/graphrefly-ts";

sample(state(1), state(0));
```

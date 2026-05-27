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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Node whose latest value is sampled. |
| <code>notifier</code> | <code>Node&lt;unknown&gt;</code> | When this node emits `DATA`, a sample is taken. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Sampled snapshots of `source`.

## Basic Usage

```ts
import { sample, state } from "@graphrefly/pure-ts";

sample(state(1), state(0));
```

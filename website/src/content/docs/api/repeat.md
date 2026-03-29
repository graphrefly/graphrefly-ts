---
title: "repeat()"
description: "Subscribes to `source` repeatedly (`count` times, sequentially). Best with a fresh or `resubscribable` source."
---

Subscribes to `source` repeatedly (`count` times, sequentially). Best with a fresh or `resubscribable` source.

## Signature

```ts
function repeat<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node to replay. |
| `count` | `number` | Number of subscription rounds. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Forwards each round then completes after the last inner `COMPLETE`.

## Basic Usage

```ts
import { repeat, state } from "@graphrefly/graphrefly-ts";

repeat(state(1, { resubscribable: true }), 2);
```

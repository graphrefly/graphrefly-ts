---
title: "shareReplay()"
description: "RxJS-named alias for replay — multicast with a replay buffer of size `bufferSize`."
---

RxJS-named alias for replay — multicast with a replay buffer of size `bufferSize`.

## Signature

```ts
function replay<T>(source: Node<T>, bufferSize: number, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `bufferSize` | `number` | Maximum past values to replay (≥ 1). |
| `opts` | `ExtraOpts` | Producer options. |

## Returns

Same behavior as `replay`.

## Basic Usage

```ts
import { shareReplay, state } from "@graphrefly/graphrefly-ts";

shareReplay(state(0), 5);
```

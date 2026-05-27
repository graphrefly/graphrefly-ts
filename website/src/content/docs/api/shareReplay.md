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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>bufferSize</code> | <code>number</code> | Maximum past values to replay (≥ 1). |
| <code>opts</code> | <code>ExtraOpts</code> | Producer options. |

## Returns

Same behavior as `replay`.

## Basic Usage

```ts
import { shareReplay, state } from "@graphrefly/graphrefly";

shareReplay(state(0), 5);
```

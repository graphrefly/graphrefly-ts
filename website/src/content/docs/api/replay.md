---
title: "replay()"
description: "Like share with a bounded replay buffer: new subscribers receive the last `bufferSize`\n`DATA` payloads (as separate batches) before live updates."
---

Like share with a bounded replay buffer: new subscribers receive the last `bufferSize`
`DATA` payloads (as separate batches) before live updates.

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

`Node&lt;T&gt;` — multicast with replay on subscribe.

## Basic Usage

```ts
import { replay, state } from "@graphrefly/graphrefly-ts";

replay(state(0), 3);
```

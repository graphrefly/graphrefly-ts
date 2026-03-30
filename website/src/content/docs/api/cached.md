---
title: "cached()"
description: "replay with `bufferSize === 1` — replays the latest `DATA` to new subscribers."
---

replay with `bufferSize === 1` — replays the latest `DATA` to new subscribers.

## Signature

```ts
function cached<T>(source: Node<T>, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `opts` | `ExtraOpts` | Producer options. |

## Returns

`Node&lt;T&gt;` — share + last-value replay.

## Basic Usage

```ts
import { cached, state } from "@graphrefly/graphrefly-ts";

cached(state(0));
```

---
title: "share()"
description: "Multicasts upstream: one subscription to `source` while this wrapper has subscribers (via producer)."
---

Multicasts upstream: one subscription to `source` while this wrapper has subscribers (via producer).

## Signature

```ts
function share<T>(source: Node<T>, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node to share. |
| `opts` | `ExtraOpts` | Producer options; `initial` seeds from `source.cache` when set by factory. |

## Returns

`Node&lt;T&gt;` — hot ref-counted bridge.

## Basic Usage

```ts
import { share, state } from "@graphrefly/graphrefly-ts";

share(state(0));
```

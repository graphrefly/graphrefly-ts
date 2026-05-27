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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node to replay. |
| <code>count</code> | <code>number</code> | Number of subscription rounds. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Forwards each round then completes after the last inner `COMPLETE`.

## Basic Usage

```ts
import { repeat, state } from "@graphrefly/pure-ts";

repeat(state(1, { resubscribable: true }), 2);
```

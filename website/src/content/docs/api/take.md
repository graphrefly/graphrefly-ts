---
title: "take()"
description: "Emits at most `count` **`DATA`** values, then **`COMPLETE`**. `RESOLVED` does not advance the counter."
---

Emits at most `count` **`DATA`** values, then **`COMPLETE`**. `RESOLVED` does not advance the counter.

## Signature

```ts
function take<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>count</code> | <code>number</code> | Maximum `DATA` emissions (≤0 completes immediately). |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Limited stream.

## Basic Usage

```ts
import { take, state } from "@graphrefly/pure-ts";

const n = take(state(0), 3);
```

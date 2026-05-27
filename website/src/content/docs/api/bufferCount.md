---
title: "bufferCount()"
description: "Batches consecutive `DATA` values into arrays of length `count` (`bufferCount` / `windowCount`)."
---

Batches consecutive `DATA` values into arrays of length `count` (`bufferCount` / `windowCount`).

## Signature

```ts
function bufferCount<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T[]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>count</code> | <code>number</code> | Buffer size before emit; must be &gt; 0. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T[]&gt;` - Emits fixed-size arrays; remainder flushes on `COMPLETE`.

## Basic Usage

```ts
import { bufferCount, state } from "@graphrefly/pure-ts";

bufferCount(state(0), 3);
```

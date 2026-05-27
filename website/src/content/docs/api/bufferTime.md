---
title: "bufferTime()"
description: "Flushes buffered `DATA` values every `ms` (`bufferTime` / `windowTime`)."
---

Flushes buffered `DATA` values every `ms` (`bufferTime` / `windowTime`).

## Signature

```ts
function bufferTime<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T[]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>ms</code> | <code>number</code> | Flush interval in milliseconds. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T[]&gt;` - Time-windowed batches.

## Basic Usage

```ts
import { bufferTime, state } from "@graphrefly/pure-ts";

bufferTime(state(0), 250);
```

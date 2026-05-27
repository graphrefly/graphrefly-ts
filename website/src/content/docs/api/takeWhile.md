---
title: "takeWhile()"
description: "Emits while `predicate` holds; on first false, sends **`COMPLETE`**."
---

Emits while `predicate` holds; on first false, sends **`COMPLETE`**.

## Signature

```ts
function takeWhile<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>predicate</code> | <code>(value: T) =&gt; boolean</code> | Continuation test. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Truncated stream.

## Basic Usage

```ts
import { takeWhile, state } from "@graphrefly/pure-ts";

const n = takeWhile(state(1), (x) => x < 10);
```

---
title: "find()"
description: "Emits the first value matching `predicate`, then **`COMPLETE`**."
---

Emits the first value matching `predicate`, then **`COMPLETE`**.

## Signature

```ts
function find<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `predicate` | `(value: T) =&gt; boolean` | Match test. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - First-match stream.

## Basic Usage

```ts
import { find, state } from "@graphrefly/graphrefly-ts";

const n = find(state(1), (x) => x > 0);
```

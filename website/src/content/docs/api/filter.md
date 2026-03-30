---
title: "filter()"
description: "Forwards values that satisfy `predicate`; otherwise emits `RESOLVED` with no `DATA` (two-phase semantics)."
---

Forwards values that satisfy `predicate`; otherwise emits `RESOLVED` with no `DATA` (two-phase semantics).

## Signature

```ts
function filter<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `predicate` | `(value: T) =&gt; boolean` | Inclusion test. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Filtered node.

## Basic Usage

```ts
import { filter, state } from "@graphrefly/graphrefly-ts";

const n = filter(state(1), (x) => x > 0);
```

---
title: "distinctUntilChanged()"
description: "Suppresses adjacent duplicates using `equals` (default `Object.is`)."
---

Suppresses adjacent duplicates using `equals` (default `Object.is`).

## Signature

```ts
function distinctUntilChanged<T>(
	source: Node<T>,
	equals: (a: T, b: T) => boolean = Object.is,
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `equals` | `(a: T, b: T) =&gt; boolean` | Optional equality for consecutive values. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Deduped stream.

## Basic Usage

```ts
import { distinctUntilChanged, state } from "@graphrefly/graphrefly-ts";

const n = distinctUntilChanged(state(1));
```

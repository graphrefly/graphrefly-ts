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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>equals</code> | <code>(a: T, b: T) =&gt; boolean</code> | Optional equality for consecutive values. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Deduped stream.

## Basic Usage

```ts
import { distinctUntilChanged, state } from "@graphrefly/pure-ts";

const n = distinctUntilChanged(state(1));
```

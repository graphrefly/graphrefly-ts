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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>predicate</code> | <code>(value: T) =&gt; boolean</code> | Match test. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - First-match stream.

## Basic Usage

```ts
import { find, state } from "@graphrefly/pure-ts";

const n = find(state(1), (x) => x > 0);
```

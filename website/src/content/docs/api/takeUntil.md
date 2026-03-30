---
title: "takeUntil()"
description: "Forwards `source` until `notifier` matches `predicate` (default: notifier **`DATA`**), then **`COMPLETE`**."
---

Forwards `source` until `notifier` matches `predicate` (default: notifier **`DATA`**), then **`COMPLETE`**.

## Signature

```ts
function takeUntil<T>(
	source: Node<T>,
	notifier: Node,
	opts?: ExtraOpts & { predicate?: (msg: Message) => boolean },
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Main upstream. |
| `notifier` | `Node` | Triggers completion when `predicate(msg)` is true. |
| `opts` | `ExtraOpts & { predicate?: (msg: Message) =&gt; boolean }` | Optional NodeOptions, plus `predicate` for custom notifier matching. |

## Returns

`Node&lt;T&gt;` - Truncated stream.

## Basic Usage

```ts
import { producer, takeUntil, state } from "@graphrefly/graphrefly-ts";

const src = state(1);
const stop = producer((_d, a) => a.emit(undefined));
const n = takeUntil(src, stop);
```

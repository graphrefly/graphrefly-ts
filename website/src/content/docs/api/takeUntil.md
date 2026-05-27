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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Main upstream. |
| <code>notifier</code> | <code>Node</code> | Triggers completion when `predicate(msg)` is true. |
| <code>opts</code> | <code>ExtraOpts & { predicate?: (msg: Message) =&gt; boolean }</code> | Optional NodeOptions, plus `predicate` for custom notifier matching. |

## Returns

`Node&lt;T&gt;` - Truncated stream.

## Basic Usage

```ts
import { producer, takeUntil, state } from "@graphrefly/pure-ts";

const src = state(1);
const stop = producer((_d, a) => a.emit(undefined));
const n = takeUntil(src, stop);
```

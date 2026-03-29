---
title: "window()"
description: "Opens a new buffer whenever `notifier` settles; emits arrays of source values (`window`)."
---

Opens a new buffer whenever `notifier` settles; emits arrays of source values (`window`).

## Signature

```ts
function window<T>(source: Node<T>, notifier: Node<unknown>, opts?: ExtraOpts): Node<T[]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `notifier` | `Node&lt;unknown&gt;` | Same role as . |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T[]&gt;` - Alias of .

## Basic Usage

```ts
import { window, state } from "@graphrefly/graphrefly-ts";

window(state(0), state(0));
```

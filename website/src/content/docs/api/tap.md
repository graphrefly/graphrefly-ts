---
title: "tap()"
description: "Invokes `fn` for side effects; values pass through unchanged."
---

Invokes `fn` for side effects; values pass through unchanged.

## Signature

```ts
function tap<T>(source: Node<T>, fn: (value: T) => void, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `fn` | `(value: T) =&gt; void` | Side effect per value. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Passthrough node.

## Basic Usage

```ts
import { tap, state } from "@graphrefly/graphrefly-ts";

const n = tap(state(1), (x) => console.log(x));
```

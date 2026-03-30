---
title: "audit()"
description: "After each source `DATA`, waits `ms` then emits the latest value if another `DATA` has not arrived (`auditTime` / trailing window)."
---

After each source `DATA`, waits `ms` then emits the latest value if another `DATA` has not arrived (`auditTime` / trailing window).

## Signature

```ts
function audit<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `ms` | `number` | Window in milliseconds after each `DATA`. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Trailing-edge sampled stream.

## Basic Usage

```ts
import { audit, state } from "@graphrefly/graphrefly-ts";

audit(state(0), 100);
```

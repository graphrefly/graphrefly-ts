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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>ms</code> | <code>number</code> | Window in milliseconds after each `DATA`. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Trailing-edge sampled stream.

## Basic Usage

```ts
import { audit, state } from "@graphrefly/pure-ts";

audit(state(0), 100);
```

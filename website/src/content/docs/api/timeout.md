---
title: "timeout()"
description: "Errors if no `DATA` arrives within `ms` after subscribe or after the previous `DATA`."
---

Errors if no `DATA` arrives within `ms` after subscribe or after the previous `DATA`.

## Signature

```ts
function timeout<T>(
	source: Node<T>,
	ms: number,
	opts?: ExtraOpts & { with?: unknown },
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `ms` | `number` | Idle budget in milliseconds. |
| `opts` | `ExtraOpts & { with?: unknown }` | Optional NodeOptions (excluding `describeKind`) and `with` for a custom error payload. |

## Returns

`Node&lt;T&gt;` - Pass-through with idle watchdog.

## Basic Usage

```ts
import { timeout, state } from "@graphrefly/graphrefly-ts";

timeout(state(0), 5_000);
```

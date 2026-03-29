---
title: "throttle()"
description: "Rate-limits emissions to at most once per `ms` window (`throttleTime`)."
---

Rate-limits emissions to at most once per `ms` window (`throttleTime`).

## Signature

```ts
function throttle<T>(
	source: Node<T>,
	ms: number,
	opts?: ExtraOpts & ThrottleOptions,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `ms` | `number` | Minimum spacing in milliseconds. |
| `opts` | `ExtraOpts & ThrottleOptions` | Optional  (excluding `describeKind`) plus `leading` / `trailing`. |

## Returns

`Node&lt;T&gt;` - Throttled stream.

## Basic Usage

```ts
import { throttle, state } from "@graphrefly/graphrefly-ts";

throttle(state(0), 1_000, { trailing: false });
```

---
title: "throttleTime()"
description: "RxJS-named alias for throttle — emits on leading/trailing edges within `ms`."
---

RxJS-named alias for throttle — emits on leading/trailing edges within `ms`.

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
| `opts` | `ExtraOpts & ThrottleOptions` | Optional NodeOptions (excluding `describeKind`) plus `leading` / `trailing`. |

## Returns

Throttled node; behavior matches `throttle`.

## Basic Usage

```ts
import { throttleTime, state } from "@graphrefly/graphrefly-ts";

throttleTime(state(0), 100);
```

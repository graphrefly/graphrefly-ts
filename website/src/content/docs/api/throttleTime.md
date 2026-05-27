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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>ms</code> | <code>number</code> | Minimum spacing in milliseconds. |
| <code>opts</code> | <code>ExtraOpts & ThrottleOptions</code> | Optional NodeOptions (excluding `describeKind`) plus `leading` / `trailing`. |

## Returns

Throttled node; behavior matches `throttle`.

## Basic Usage

```ts
import { throttleTime, state } from "@graphrefly/pure-ts";

throttleTime(state(0), 100);
```

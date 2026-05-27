---
title: "throttle()"
description: "Rate-limits emissions to at most once per `ms` window (`throttleTime`).\n\nWhen `trailing: true`, pending trailing values are flushed on source\nCOMPLETE (and on D"
---

Rate-limits emissions to at most once per `ms` window (`throttleTime`).

When `trailing: true`, pending trailing values are flushed on source
COMPLETE (and on Dead-source R2.2.7.b). This intentionally diverges from
RxJS `throttleTime` v7 (which drops trailing pending on COMPLETE) for
symmetry with `debounce`'s live-COMPLETE behavior.

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

`Node&lt;T&gt;` - Throttled stream.

## Basic Usage

```ts
import { throttle, state } from "@graphrefly/pure-ts";

throttle(state(0), 1_000, { trailing: false });
```

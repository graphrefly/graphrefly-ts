---
title: "catchError()"
description: "RxJS-named alias for rescue — replaces upstream `ERROR` with a recovered value."
---

RxJS-named alias for rescue — replaces upstream `ERROR` with a recovered value.

## Signature

```ts
function rescue<T>(
	source: Node<T>,
	recover: (err: unknown) => T,
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `recover` | `(err: unknown) =&gt; T` | Maps the error payload to a replacement value; if it throws, `ERROR` is forwarded. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

Recovered stream; behavior matches `rescue`.

## Basic Usage

```ts
import { catchError, state } from "@graphrefly/graphrefly-ts";

catchError(state(0), () => 0);
```

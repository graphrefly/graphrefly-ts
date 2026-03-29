---
title: "rescue()"
description: "Replaces an upstream `ERROR` with a recovered value (`catchError`-style)."
---

Replaces an upstream `ERROR` with a recovered value (`catchError`-style).

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
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Recovered stream.

## Basic Usage

```ts
import { rescue, state } from "@graphrefly/graphrefly-ts";

rescue(state(0), () => 0);
```

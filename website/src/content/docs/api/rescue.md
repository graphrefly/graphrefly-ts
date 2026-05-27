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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>recover</code> | <code>(err: unknown) =&gt; T</code> | Maps the error payload to a replacement value; if it throws, `ERROR` is forwarded. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Recovered stream.

## Basic Usage

```ts
import { rescue, state } from "@graphrefly/pure-ts";

rescue(state(0), () => 0);
```

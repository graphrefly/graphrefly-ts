---
title: "withLatestFrom()"
description: "When `primary` settles, emits `[primary, latestSecondary]`. `secondary` alone updates cache only."
---

When `primary` settles, emits `[primary, latestSecondary]`. `secondary` alone updates cache only.

## Signature

```ts
function withLatestFrom<A, B>(
	primary: Node<A>,
	secondary: Node<B>,
	opts?: ExtraOpts,
): Node<readonly [A, B]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `primary` | `Node&lt;A&gt;` | Main stream. |
| `secondary` | `Node&lt;B&gt;` | Latest value is paired on each primary emission. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;readonly [A, B]&gt;` - Paired stream.

## Basic Usage

```ts
import { state, withLatestFrom } from "@graphrefly/graphrefly-ts";

const n = withLatestFrom(state(1), state("x"));
```

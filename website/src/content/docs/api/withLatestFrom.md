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
| <code>primary</code> | <code>Node&lt;A&gt;</code> | Main stream. |
| <code>secondary</code> | <code>Node&lt;B&gt;</code> | Latest value is paired on each primary emission. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;readonly [A, B]&gt;` - Paired stream.

## Basic Usage

```ts
import { state, withLatestFrom } from "@graphrefly/pure-ts";

const n = withLatestFrom(state(1), state("x"));
```

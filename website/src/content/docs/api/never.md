---
title: "never()"
description: "Never emits and never completes until teardown (cold `NEVER` analogue)."
---

Never emits and never completes until teardown (cold `NEVER` analogue).

## Signature

```ts
function never<T = never>(opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `ExtraOpts` | Optional producer options. |

## Returns

`Node&lt;T&gt;` — silent until unsubscribed.

## Basic Usage

```ts
import { never } from "@graphrefly/graphrefly-ts";

never();
```

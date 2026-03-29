---
title: "retry()"
description: "Returns a  that resubscribes to the upstream node after each terminal `ERROR`, after an optional delay."
---

Returns a  that resubscribes to the upstream node after each terminal `ERROR`, after an optional delay.

## Signature

```ts
function retry(opts?: RetryOptions): PipeOperator
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `RetryOptions` | `count` caps attempts; `backoff` supplies delay in **seconds** (or a preset name). |

## Returns

Unary operator suitable for .

## Basic Usage

```ts
import { ERROR, pipe, producer, retry, constant } from "@graphrefly/graphrefly-ts";

const src = producer(
  (_d, a) => {
    a.down([[ERROR, new Error("x")]]);
  },
{ resubscribable: true },
);
pipe(src, retry({ count: 2, backoff: constant(0.05) }));
```

## Behavior Details

- **Resubscribable sources:** The upstream should use `resubscribable: true` if it must emit again after `ERROR`.
**Protocol:** Forwards unknown message tuples unchanged; handles `DIRTY`, `DATA`, `RESOLVED`, `COMPLETE`, `ERROR`.

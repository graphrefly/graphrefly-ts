---
title: "retry()"
description: "Resubscribes to the upstream node after each terminal `ERROR`, after an optional delay."
---

Resubscribes to the upstream node after each terminal `ERROR`, after an optional delay.

## Signature

```ts
function retry<T>(source: Node<T>, opts?: RetryOptions): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node (should use `resubscribable: true`). |
| `opts` | `RetryOptions` | `count` caps attempts; `backoff` supplies delay in **nanoseconds** (or a preset name). |

## Returns

Node that retries on error.

## Basic Usage

```ts
import { ERROR, NS_PER_SEC, pipe, producer, retry, constant } from "@graphrefly/graphrefly-ts";

const src = producer(
  (_d, a) => {
    a.down([[ERROR, new Error("x")]]);
  },
{ resubscribable: true },
);
const out = retry(src, { count: 2, backoff: constant(0.25 * NS_PER_SEC) });
```

## Behavior Details

- **Resubscribable sources:** The upstream should use `resubscribable: true` if it must emit again after `ERROR`.
**Protocol:** Forwards unknown message tuples unchanged; handles `DIRTY`, `DATA`, `RESOLVED`, `COMPLETE`, `ERROR`.

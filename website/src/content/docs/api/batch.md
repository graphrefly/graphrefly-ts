---
title: "batch()"
description: "Runs `fn` inside a batch scope. Nested `batch()` calls share one deferral queue.\nIf `fn` throws (including from a nested `batch`), deferred DATA/RESOLVED for\nth"
---

Runs `fn` inside a batch scope. Nested `batch()` calls share one deferral queue.
If `fn` throws (including from a nested `batch`), deferred DATA/RESOLVED for
that **outer** `batch` frame are discarded — phase-2 is not flushed after an
error. While the drain loop is running (`flushInProgress`), a nested `batch`
that throws must **not** clear the global queue (cross-language decision A4).

During the drain loop, `isBatching()` remains true so nested `emitWithBatch`
calls still defer phase-2 messages. The drain loop runs until the queue is
quiescent (no pending work remains). Per-emission try/catch ensures one
throwing callback does not orphan remaining emissions; the first error is
re-thrown after all emissions drain. Callbacks that ran before the throw may
have applied phase-2 — partial graph state is intentional (decision C1).

## Signature

```ts
function batch(fn: () => void): void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `() =&gt; void` | — Synchronous work that may call `emitWithBatch` / `node.down()`. |

## Basic Usage

```ts
import { core } from "@graphrefly/graphrefly-ts";

core.batch(() => {
    core.emitWithBatch(sink, [[core.DATA, 1]]);
  });
```
